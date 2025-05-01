import ts, { CallExpression, PropertyAccessExpression, SyntaxKind } from 'typescript';
import { isArrayLiteralExpression, isAsyncKeyword, isBinaryExpression, isCallExpression, isFunctionLikeDeclaration, isIdentifier, isNewExpression, isNumericLiteral, isPropertyAccessExpression, isRegularExpressionLiteral, isStringLiteral, isTemplateLiteral, printNodeAndPos, SimpleFunctionLikeDeclaration } from './ts-utils';
import { empty, setFilter, setFlatMap, setMap, setSome, singleton } from './setUtil';
import { AnalysisNode, Cursor, ElementPick, isArgumentList, isElementPick, isExtern } from './abstract-values';
import { unimplemented } from './util';
import { FixedEval, FixedTrace } from './dcfa';
import { getAllValuesOf, getElementNodesOfArrayValuedNode, getMapSetCalls, resolvePromisesOfNode, subsumes } from './abstract-value-utils';
import { Config, ConfigSet, justExtern, isConfigNoExtern, isPropertyAccessConfig, pushContext, singleConfig, configSetJoinMap, unimplementedBottom, isObjectLiteralExpressionConfig, isConfigExtern, join, ConfigNoExtern, createElementPickConfigSet } from './configuration';

type BuiltInConstructor = PropertyAccessExpression | ts.Identifier | ts.CallExpression | ElementPick;

function uncallable(this: BuiltInValue) { return unimplementedBottom(`No result of calling ${this}`) }
type CallGetter = (callConfig: Config<CallExpression>, args: { fixed_eval: FixedEval, fixed_trace: FixedTrace, m: number }) => ConfigSet
const arrayFromCallGetter: CallGetter = (callConfig, { fixed_eval }) => fixed_eval(Config({
    node: callConfig.node.arguments[0],
    env: callConfig.env,
}))
const arrayReduceCallGetter: CallGetter = (callConfig, { fixed_eval, m }) => {
    const accumulatorConses = fixed_eval(Config({ node: callConfig.node.arguments[0], env: callConfig.env }));
    const initialConses = fixed_eval(Config({ node: callConfig.node.arguments[1], env: callConfig.env }));

    
    const accumulatorResults = configSetJoinMap(accumulatorConses, accumulatorCons => {
        if (!isFunctionLikeDeclaration(accumulatorCons.node)) {
            return unimplementedBottom(`Expected a function ${printNodeAndPos(accumulatorCons.node)}`)
        }
        
        return fixed_eval(Config({
            node: accumulatorCons.node.body,
            env: accumulatorCons.env.push(pushContext(callConfig.node, callConfig.env, m))
        }));
    })

    return join(initialConses, accumulatorResults);
}
const mapGetCallGetter: CallGetter = (callConfig, { fixed_eval, fixed_trace }) => {
    const mapConses = fixed_eval(Config({ node: callConfig.node.expression, env: callConfig.env }));
    const getKeyConses = fixed_eval(Config({ node: callConfig.node.arguments[0], env: callConfig.env }));

    const setSiteConfigs = configSetJoinMap(mapConses, mapConsConfig =>
        getMapSetCalls(fixed_trace(mapConsConfig), { fixed_eval })
    );
    return configSetJoinMap(setSiteConfigs, siteConfig => {
        const setKeyArg = (siteConfig.node as CallExpression).arguments[0];
        const setKeyConses = fixed_eval(Config({ node: setKeyArg, env: siteConfig.env }));

        const keyMatch = setSome(getKeyConses, getKeyCons => setSome(setKeyConses, setKeyCons =>
            subsumes(getKeyCons.node, setKeyCons.node) || subsumes(setKeyCons.node, getKeyCons.node)
        ))
        if (keyMatch) {
            const setValueArg = (siteConfig.node as CallExpression).arguments[1];
            return fixed_eval(Config({ node: setValueArg, env: siteConfig.env }));
        } else {
            return empty();
        }
    });
}

type ElementAccessGetter = (consConfig: Config<BuiltInConstructor>, args: { fixed_eval: FixedEval, fixed_trace: FixedTrace, m: number }) => ConfigSet
const arrayMapEAG: ElementAccessGetter = (consConfig, { fixed_eval, m }) => {
    const { node: cons, env } = consConfig;
    if (!isCallExpression(cons)) {
        return unimplementedBottom(`Expected ${printNodeAndPos(cons)} to be a call expression`);
    }
    const argFuncs = fixed_eval(Config({ node: cons.arguments[0], env }));
    return configSetJoinMap(argFuncs, funcConfig => {
        const { node: func, env: funcEnv } = funcConfig;
        if (!isFunctionLikeDeclaration(func)) {
            return unimplementedBottom(`Expected ${printNodeAndPos(func)} to be a function`);
        }
        return fixed_eval(Config({ node: func.body, env: funcEnv.push(pushContext(cons, env, m))}));
    })
}
const arrayFilterEAG: ElementAccessGetter = (consConfig, { fixed_eval, fixed_trace, m }) => {
    const thisArrayConsConfigs = getCallExpressionExpressionOfValue(consConfig, 'Array#filter', { fixed_eval });
    return configSetJoinMap(thisArrayConsConfigs, consConfig => getElementNodesOfArrayValuedNode(consConfig, { fixed_eval, fixed_trace, m }));
}
const mapKeysEAG: ElementAccessGetter = (consConfig, { fixed_eval, fixed_trace }) => {
    const thisMapConsConfigs = getCallExpressionExpressionOfValue(consConfig, 'Map#keys', { fixed_eval });
    const setSiteConfigs = configSetJoinMap(thisMapConsConfigs, mapConsConfig =>
        getMapSetCalls(fixed_trace(mapConsConfig), { fixed_eval })
    );
    return configSetJoinMap(setSiteConfigs, siteConfig => {
        const keyArg = (siteConfig.node as CallExpression).arguments[0];
        return fixed_eval(Config({ node: keyArg, env: siteConfig.env }));
    });
}
const objectValuesEAG: ElementAccessGetter = (consConfig, { fixed_eval, fixed_trace }) => {
    if (!isCallExpression(consConfig.node)) {
        return unimplementedBottom(`Expected ${printNodeAndPos(consConfig.node)} to be a call expression`)
    }

    if (consConfig.node.arguments.length !== 1) {
        return unimplementedBottom(`Expected a single argument ${printNodeAndPos(consConfig.node)}`)
    }

    const argConfig = { node: consConfig.node.arguments[0], env: consConfig.env };
    return configSetJoinMap(fixed_eval(Config(argConfig)), objectConsConfig => {
        if (!isObjectLiteralExpressionConfig(objectConsConfig)) {
            return unimplementedBottom(`Expected an object literal ${printNodeAndPos(objectConsConfig.node)}`)
        }
        return getAllValuesOf(objectConsConfig, fixed_eval, fixed_trace);
    })

}
function getCallExpressionExpressionOfValue(consConfig: Config<BuiltInConstructor>, val: BuiltInValue, { fixed_eval }: { fixed_eval: FixedEval }): ConfigSet {
    const { node: cons, env } = consConfig;
    if (!isCallExpression(cons)) {
        return unimplementedBottom(`Expected ${printNodeAndPos(cons)} to be a call expression`);
    }
    const funcExpression = cons.expression;
    const funcConfigs = fixed_eval(Config({ node: funcExpression, env }));
    return configSetJoinMap(funcConfigs, funcConfig => {
        if (!isPropertyAccessConfig(funcConfig) || getBuiltInValueOfBuiltInConstructor(funcConfig, fixed_eval) !== val) {
            return empty();
        }
        const { node: cons, env: funcEnv } = funcConfig;
        return fixed_eval(Config({ node: cons.expression, env: funcEnv }));
    });
}

type PrimopFunctionArgParamBinderGetter = (this: Config<ts.Expression> | undefined, primopArgIndex: number, argParameterIndex: number, callSite: Config<ts.CallExpression>, args: { fixed_eval: FixedEval, fixed_trace: FixedTrace, m: number }) => ConfigSet;
const arrayReduceABG: PrimopFunctionArgParamBinderGetter = function(primopArgIndex, argParameterIndex, callSite, { fixed_eval, fixed_trace, m }) {
    if (this === undefined) {
        return unimplementedBottom(`Cannot call reduce on undefined`);
    }

    if (primopArgIndex !== 0) {
        return unimplementedBottom(`Cannot get binding for function passed as argument ${primopArgIndex} to Array#reduce`);
    }

    if (argParameterIndex === 0) {
        return fixed_eval(callSite);
    } else if (argParameterIndex === 1) {
        return getElementNodesOfArrayValuedNode(this, { fixed_eval, fixed_trace, m })
    } else {
        return unimplementedBottom(`Unknown parameter for Array#reduce accumulator ${argParameterIndex}`);
    }
}
const standardArrayABG: PrimopFunctionArgParamBinderGetter = function(primopArgIndex, argParameterIndex, callSite, { fixed_eval, fixed_trace, m }) {
    if (this === undefined) {
        return unimplementedBottom(`Cannot call array method on undefined`);
    }

    if (primopArgIndex !== 0) {
        return unimplementedBottom(`Cannot get binding for function passed as argument ${primopArgIndex} to Array method`);
    }

    if (argParameterIndex === 0) {
        return getElementNodesOfArrayValuedNode(this, { fixed_eval, fixed_trace, m })
    } else {
        return unimplementedBottom(`Unknown arg parameter index ${argParameterIndex} for function passed to Array method ${printNodeAndPos(callSite.node)}`)
    }
}
const promiseThenABG: PrimopFunctionArgParamBinderGetter = function(primopArgIndex, argParameterIndex, callSite, { fixed_eval, fixed_trace, m }) {
    if (this === undefined) {
        return unimplementedBottom(`Cannot call then on undefined`);
    }

    if (primopArgIndex !== 0) {
        return unimplementedBottom(`Cannot get binding for function passed as argument ${primopArgIndex} to Array method`);
    }

    if (argParameterIndex === 0) {
        return resolvePromisesOfNode(this, fixed_eval)
    } else {
        return unimplementedBottom(`Unknown arg parameter index ${argParameterIndex} for function passed to Array method ${printNodeAndPos(callSite.node)}`)
    }
}

const zeroth = [0];

const inaccessibleProperty: PropertyAccessGetter = ({ node: pa }) => unimplementedBottom(`Unable to get property ${printNodeAndPos(pa)}`) ;
const inaccessibleElement: ElementAccessGetter = ({ node }) =>
    unimplementedBottom(`Unable to get element of ${printNodeAndPos(node)}`);
function notSupported(_, __, callSite) { return unimplementedBottom(`Unimplemented function arg param binder getter for ${printNodeAndPos(callSite.node)}`) };
const none = []
const bottomBehavior: BuiltInValueBehavior = {
    resultOfCalling: uncallable,
    resultOfPropertyAccess: inaccessibleProperty,
    resultOfElementAccess: inaccessibleElement,
    primopBinderGetter: notSupported,
    higherOrderArgs: none,
};

const builtInValues = ['Array', 'Array#concat', 'Array#filter', 'Array#filter()', 'Array#find',
    'Array#forEach', 'Array#includes', 'Array#includes()', 'Array#indexOf', 'Array#indexOf()',
    'Array#join', 'Array#join()', 'Array#map', 'Array#map()', 'Array#push', 'Array#reduce',
    'Array#slice', 'Array#slice()', 'Array#some', 'Array#some()',
    'Array.from', 'Array.isArray',
    'Boolean',
    'Buffer', 'Buffer.from',
    'Date', 'Date#getTime', 'Date#toISOString',
    'Date#toLocaleDateString', 'Date#toLocaleDateString()', 'Date#toLocaleString',
    'Date.now', 'Date.now()', 'Date.UTC',
    'Error', 'JSON', 'JSON.parse', 'JSON.stringify', 'JSON.stringify()',
    'Map', 'Map#get', 'Map#keys', 'Map#keys()', 'Map#set', 'Math', 'Math.floor', 'Math.floor()',
    'Number', 'Number#toFixed', 'Number.isNaN', 'Number.parseInt',
    'Object', 'Object.assign', 'Object.fromEntries',
    'Object.entries', 'Object.entries()', 'Object.entries()[]',
    'Object.freeze', 'Object.keys', 'Object.values', 'Object.values()',
    'Promise', 'Promise#then', 'Promise.all', 'Promise.all()', 'Promise.allSettled',
    'Promise.allSettled()', 'Promise.resolve', 'Promise.resolve()',
    'RegExp#test', 'RegExp#test()',
    'String', 'String#endsWith', 'String#includes', 'String#includes()',
    'String#match', 'String#match()', 'String#replace', 'String#replace()', 'String#slice',
    'String#split', 'String#split()', 'String#split()[]',
    'String#substring', 'String#substring()', 'String#toLowerCase', 'String#toLowerCase()',
    'String#trim', 'String#trim()',
    'URL', 'URL#href', 'URL#searchParams',
    'URLSearchParams', 'URLSearchParams#set', 'URLSearchParams#toString',
    'console', 'console.log', 'console.log()', 'console.error', 'console.error()',
    'console.table', 'console.warn', 'console.warn()',
    'fetch', 'isNaN', 'parseInt', 'parseFloat', 'parseFloat()',
    'process', 'process.cwd', 'process.cwd()', 'process.env', 'process.env[]',
    'undefined',
] as const;
type BuiltInValue = typeof builtInValues[number];

export const builtInValueBehaviors: { [k in BuiltInValue] : BuiltInValueBehavior} = {
    'Array': builtInObject(['Array.from', 'Array.isArray']),
    'Array#concat': builtInFunction(),
    'Array#filter': standardArrayMethod(),
    'Array#filter()': arrayValued(arrayFilterEAG),
    'Array#find': standardArrayMethod(),
    'Array#forEach': standardArrayMethod(),
    'Array#includes': builtInFunction(),
    'Array#includes()': bottomBehavior,
    'Array#indexOf': builtInFunction(),
    'Array#indexOf()': proto('Number'),
    'Array#join': builtInFunction(),
    'Array#join()': proto('String'),
    'Array#map': standardArrayMethod(),
    'Array#map()': arrayValued(arrayMapEAG),
    'Array#push': builtInFunction(),
    'Array#reduce': {... bottomBehavior, resultOfCalling: arrayReduceCallGetter, higherOrderArgs: zeroth, primopBinderGetter: arrayReduceABG },
    'Array#slice': builtInFunction(),
    'Array#slice()': arrayValued(inaccessibleElement), // TODO
    'Array#some': standardArrayMethod(),
    'Array#some()': bottomBehavior,
    'Array.from': { ...bottomBehavior, resultOfCalling: arrayFromCallGetter },
    'Array.isArray': builtInFunction(),
    'Boolean': callableObject(),
    'Buffer': builtInObject(['Buffer.from']),
    'Buffer.from': builtInFunction(),
    'Date': builtInObject(['Date.now', 'Date.UTC']),
    'Date#getTime': builtInFunction(),
    'Date#toISOString': builtInFunction(),
    'Date#toLocaleDateString': builtInFunction(),
    'Date#toLocaleDateString()': proto('String'),
    'Date#toLocaleString': builtInFunction(),
    'Date.now': builtInFunction(),
    'Date.now()': proto('Date'),
    'Date.UTC': builtInFunction(),
    'Error': builtInObject(),
    'JSON': builtInObject(['JSON.parse', 'JSON.stringify']),
    'JSON.parse': { ...bottomBehavior, resultOfCalling: () => justExtern },
    'JSON.stringify': builtInFunction(),
    'JSON.stringify()': proto('String'),
    'Map': builtInObject(),
    'Map#get': { ...bottomBehavior, resultOfCalling: mapGetCallGetter },
    'Map#keys': builtInFunction(),
    'Map#keys()': arrayValued(mapKeysEAG),
    'Map#set': builtInFunction(),
    'Math': builtInObject(['Math.floor']),
    'Math.floor': builtInFunction(),
    'Math.floor()': proto('Number'),
    'Number': callableObject(['Number.isNaN', 'Number.parseInt']),
    'Number#toFixed': builtInFunction(),
    'Number.isNaN': builtInFunction(),
    'Number.parseInt': builtInFunction(),
    'Object': builtInObject(['Object.assign', 'Object.fromEntries', 'Object.entries', 'Object.freeze', 'Object.keys', 'Object.values']),
    'Object.assign': builtInFunction(),
    'Object.fromEntries': builtInFunction(),
    'Object.entries': builtInFunction(),
    'Object.entries()': arrayValued(createElementPickConfigSet),
    'Object.entries()[]': bottomBehavior,
    'Object.freeze': builtInFunction(),
    'Object.keys': builtInFunction(),
    'Object.values': builtInFunction(),
    'Object.values()': arrayValued(objectValuesEAG),
    'Promise': builtInObject(['Promise.all', 'Promise.allSettled', 'Promise.resolve']),
    'Promise#then': builtInFunction({ primopBinderGetter: promiseThenABG, higherOrderArgs: zeroth }),
    'Promise.all': builtInFunction(),
    'Promise.all()': bottomBehavior,
    'Promise.allSettled': builtInFunction(),
    'Promise.allSettled()': bottomBehavior,
    'Promise.resolve': builtInFunction(),
    'Promise.resolve()': proto('Promise'),
    'RegExp#test': builtInFunction(),
    'RegExp#test()': bottomBehavior,
    'String': callableObject(),
    'String#endsWith': builtInFunction(),
    'String#includes': builtInFunction(),
    'String#includes()': bottomBehavior,
    'String#match': builtInFunction(),
    'String#match()': bottomBehavior,
    'String#replace': builtInFunction(),
    'String#replace()': proto('String'),
    'String#slice': builtInFunction(),
    'String#split': builtInFunction(),
    'String#split()': arrayValued(createElementPickConfigSet),
    'String#split()[]': proto('String'),
    'String#substring': builtInFunction(),
    'String#substring()': proto('String'),
    'String#toLowerCase': builtInFunction(),
    'String#toLowerCase()': proto('String'),
    'String#trim': builtInFunction(),
    'String#trim()': proto('String'),
    'URL': builtInObject(),
    'URL#href': proto('String'),
    'URL#searchParams': proto('URLSearchParams'),
    'URLSearchParams': builtInObject(),
    'URLSearchParams#set': builtInFunction(),
    'URLSearchParams#toString': builtInFunction(),
    'console': builtInObject(['console.log', 'console.error', 'console.table', 'console.warn']),
    'console.log': builtInFunction(),
    'console.log()': bottomBehavior,
    'console.error': builtInFunction(),
    'console.error()': bottomBehavior,
    'console.table': builtInFunction(),
    'console.warn': builtInFunction(),
    'console.warn()': bottomBehavior,
    'fetch': { ...bottomBehavior, resultOfCalling: () => justExtern },
    'isNaN': builtInFunction(),
    'parseInt': builtInFunction(),
    'parseFloat': builtInFunction(),
    'parseFloat()': proto('Number'),
    'process': builtInObject(['process.cwd', 'process.env']),
    'process.cwd': builtInFunction(),
    'process.cwd()': proto('String'),
    'process.env': arrayValued(createElementPickConfigSet),
    'process.env[]': proto('String'),
    'undefined': { ...bottomBehavior, resultOfCalling: () => empty() },
}

type BuiltInValueBehavior = {
    resultOfCalling: CallGetter,
    resultOfPropertyAccess: PropertyAccessGetter,
    resultOfElementAccess: ElementAccessGetter,
    primopBinderGetter: PrimopFunctionArgParamBinderGetter,
    higherOrderArgs: number[],
}



function builtInObject(staticMethods?: BuiltInValue[]): BuiltInValueBehavior {
    return {
        ...bottomBehavior,
        resultOfPropertyAccess: builtInStaticMethods(...(staticMethods ?? [])),
    }
}

function callableObject(staticMethods?: BuiltInValue[]): BuiltInValueBehavior {
    return {
        ... builtInObject(staticMethods),
        resultOfCalling: singleConfig,
    }
}

function builtInFunction(args?: Partial<BuiltInValueBehavior>): BuiltInValueBehavior {
    return {
        ...bottomBehavior,
        resultOfCalling: singleConfig,
        ...args,
    }
}

function arrayValued(resultOfElementAccess: ElementAccessGetter): BuiltInValueBehavior {
    return {
        ...bottomBehavior,
        resultOfPropertyAccess: builtInProtoMethod('Array'),
        resultOfElementAccess,
    }
}

function standardArrayMethod(): BuiltInValueBehavior {
    return {
        ...builtInFunction(),
        primopBinderGetter: standardArrayABG,
        higherOrderArgs: zeroth,
    }
}

function proto(proto: BuiltInProto) {
    return {
        ...bottomBehavior,
        resultOfPropertyAccess: builtInProtoMethod(proto)
    }
}

const builtInProtosObject = {
    'Array': true,
    'Date': true,
    'Error': true,
    'Map': true,
    'Number': true,
    'Object': true,
    'Promise': true,
    'RegExp': true,
    'String': true,
    'URL': true,
    'URLSearchParams': true,
}
export type BuiltInProto = keyof typeof builtInProtosObject;
export function isBuiltInProto(str: string): str is BuiltInProto {
    return Object.keys(builtInProtosObject).includes(str);
}

/**
 * Given a node that we already know represents some built-in value, which built in value does it represent?
 * Note that this assumes there are no methods that share a name.
 */
export function getBuiltInValueOfBuiltInConstructor(builtInConstructorConfig: Config<BuiltInConstructor>, fixed_eval: FixedEval): BuiltInValue {
    const { node: builtInConstructor, env } = builtInConstructorConfig;

    if (isPropertyAccessExpression(builtInConstructor)) {
        const methodName = builtInConstructor.name.text;
        const builtInValue = builtInValues.find(val =>
            typeof val === 'string' && (val.split('#')[1] === methodName || val.split('.')[1] === methodName)
        );
        assertNotUndefined(builtInValue);
        return builtInValue;
    } else if (isIdentifier(builtInConstructor)) {
        const builtInValue = builtInValues.find(val => val === builtInConstructor.text);
        assertNotUndefined(builtInValue);
        return builtInValue;
    } else if (isElementPick(builtInConstructor)) {
        const expressionConses = fixed_eval(Config({ node: builtInConstructor.expression, env }));
        const expressionBuiltIns = setFlatMap(expressionConses, expressionCons => {
            if (isConfigExtern(expressionCons)) {
                return empty<BuiltInValue>();
            }

            if (!isBuiltInConstructorShapedConfig(expressionCons)) {
                return empty<BuiltInValue>();
            }

            return singleton(getBuiltInValueOfBuiltInConstructor(expressionCons, fixed_eval));
        });
        const builtInValue = expressionBuiltIns.find(expressionBuiltIn => builtInValues.some(biv => biv === expressionBuiltIn + '[]'));
        assertNotUndefined(builtInValue);
        return builtInValue + '[]' as BuiltInValue;
    } else { // call expression
        const expressionBuiltInValue = getBuiltInValueOfExpression(builtInConstructorConfig as Config<ts.CallExpression>);
        const builtInValue = builtInValues.find(val =>
            typeof val === 'string' && val.includes('()') && val.split('()')[0] === expressionBuiltInValue
        );
        assertNotUndefined(builtInValue);
        return builtInValue;
    }

    function getBuiltInValueOfExpression(callConfig: Config<ts.CallExpression>): BuiltInValue {
        const expressionConses = fixed_eval(Config({
            node: callConfig.node.expression,
            env: callConfig.env,
        }));
        const builtInConstructorsForExpression = setFilter(
            expressionConses,
            isBuiltInConstructorShapedConfig
        );
        const builtInValues = setMap(builtInConstructorsForExpression, expressionConstructor =>
            getBuiltInValueOfBuiltInConstructor(expressionConstructor, fixed_eval)
        );
        if (builtInValues.size !== 1) {
            throw new Error(`Expected exactly one built in constructor for expression of ${printNodeAndPos(builtInConstructor)}`);
        }
        return builtInValues.last()!;
    }

    function assertNotUndefined<T>(val: T | undefined): asserts val is T {
        if (val === undefined) {
            throw new Error(`No matching built in value for built-in value constructor ${printNodeAndPos(builtInConstructor)}`)
        }
    }
}

/**
 * If a node is shaped like a built in constructor and is a value, it is a built in constructor
 */
export function isBuiltInConstructorShaped(node: Cursor): node is BuiltInConstructor {
    if (isExtern(node)) {
        return false;
    }

    return isPropertyAccessExpression(node)
        || isIdentifier(node)
        || isCallExpression(node)
        || isElementPick(node);
}
export function isBuiltInConstructorShapedConfig(config: Config): config is Config<BuiltInConstructor> {
    return isBuiltInConstructorShaped(config.node);
}

export function idIsBuiltIn(id: ts.Identifier): boolean {
    return builtInValues.some(val => val === id.text);
}

type PropertyAccessGetter = (propertyAccessConfig: Config<PropertyAccessExpression>, args: { fixed_eval: FixedEval }) => ConfigSet;
function builtInStaticMethods(...names: BuiltInValue[]): PropertyAccessGetter {
    const methodNames = names.map(name => name.split('.')[1]);
    return (pac, { fixed_eval }) => methodNames.some(methodName => pac.node.name.text === methodName)
        ? singleConfig(pac)
        : inaccessibleProperty(pac, { fixed_eval });
}
function builtInProtoMethod(typeName: BuiltInProto): PropertyAccessGetter {
    return (pac, { fixed_eval }) => {
        const expressionConses = fixed_eval(Config({ node: pac.node.expression, env: pac.env}));
        const isBuiltInProtoMethod = expressionConses.some(consConfig =>
            isConfigNoExtern(consConfig)
            && getPropertyOfProto(typeName, pac.node.name.text, consConfig, pac, fixed_eval).size > 0
        )
        return isBuiltInProtoMethod
            ? singleConfig(pac)
            : inaccessibleProperty(pac, { fixed_eval });
    }
}
/**
 * @param cons here we're assuming a constructor that isn't "built in"
 */
export function getProtoOf(cons: AnalysisNode): BuiltInProto | null {
    if (isStringLiteral(cons) || isTemplateLiteral(cons)) {
        return 'String';
    } else if (isRegularExpressionLiteral(cons)) {
        return 'RegExp';
    } else if (isArrayLiteralExpression(cons) || isArgumentList(cons)) {
        return 'Array';
    } else if (isNewExpression(cons)) {
        if (ts.isIdentifier(cons.expression)) {
            if (cons.expression.text === 'Map') {
                return 'Map';
            } else if (cons.expression.text === 'Error') {
                return 'Error';
            } else if (cons.expression.text === 'URL') {
                return 'URL';
            } else if (cons.expression.text === 'URLSearchParams') {
                return 'URLSearchParams';
            }
        }
        return 'Object';
    } else if (isBinaryExpression(cons)
        && (cons.operatorToken.kind === SyntaxKind.AsteriskToken || cons.operatorToken.kind === SyntaxKind.SlashToken)
    ) {
        return 'Number';
    } else if (isNumericLiteral(cons)) {
        return 'Number'
    } else if (isAsyncKeyword(cons)) {
        return 'Promise';
    }
    return unimplemented(`Unable to get type for ${printNodeAndPos(cons)}`, null);
}

export function getPropertyOfProto(proto: BuiltInProto, propertyName: string, expressionConsConfig: ConfigNoExtern, accessConfig: Config<ts.PropertyAccessExpression>, fixed_eval: FixedEval): ConfigSet {
    const { node: expressionCons, env: expressionConsEnv } = expressionConsConfig;
    if (proto === 'Error' && propertyName === 'message') { // special case this for now. If we need more special properties, we'll find those later.
        if (!isNewExpression(expressionCons) || expressionCons.arguments === undefined) {
            return unimplementedBottom(`Expected ${printNodeAndPos(expressionCons)} to be a new Error expression with defined arguments`);
        }
        if (expressionCons.arguments.length > 0) {
            return fixed_eval(Config({ node: expressionCons.arguments[0], env: expressionConsEnv }));
        }
        return empty();
    } else if (proto === 'String' && propertyName === 'message') {
        return empty();
    }
    const builtInValueExists = builtInValues.some(val => {
        const [valType, valMethod] = val.split('#');
        return proto === valType && valMethod === propertyName;
    });
    return builtInValueExists
        ? singleton(accessConfig)
        : unimplementedBottom(`Could not find proto value ${printNodeAndPos(accessConfig.node)}`);
}
