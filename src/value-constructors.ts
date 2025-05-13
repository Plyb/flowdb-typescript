import ts, { CallExpression, PropertyAccessExpression, SyntaxKind } from 'typescript';
import { isArrayLiteralExpression, isAsyncKeyword, isBinaryExpression, isCallExpression, isFunctionLikeDeclaration, isIdentifier, isNewExpression, isNumericLiteral, isPropertyAccessExpression, isRegularExpressionLiteral, isStringLiteral, isTemplateLiteral, printNodeAndPos, SimpleFunctionLikeDeclaration } from './ts-utils';
import { empty, setFilter, setFlatMap, setMap, setSift, setSome, singleton } from './setUtil';
import { AnalysisNode, Cursor, ElementPick, isArgumentList, isElementPick, isExtern } from './abstract-values';
import { unimplemented } from './util';
import { FixedEval, FixedTrace } from './dcfa';
import { getAllValuesOf, getElementNodesOfArrayValuedNode, getMapSetCalls, resolvePromisesOfNode, subsumes } from './abstract-value-utils';
import { Config, ConfigSet, justExtern, isConfigNoExtern, isPropertyAccessConfig, pushContext, singleConfig, configSetJoinMap, unimplementedBottom, isObjectLiteralExpressionConfig, isConfigExtern, join, ConfigNoExtern, createElementPickConfig, BuiltInConfig, printConfig } from './configuration';

function uncallable(this: BuiltInValue) { return unimplementedBottom(`No result of calling ${this}`) }
type CallGetter = (callConfig: Config<CallExpression>, args: { fixed_eval: FixedEval, fixed_trace: FixedTrace, m: number, expressionBuiltInValue: BuiltInValue }) => ConfigSet
const callExpressionResult: CallGetter = (callConfig: Config<ts.CallExpression>, { expressionBuiltInValue }) => singleConfig(
    callConfig.set('builtInValue', getCallBuiltInValue(expressionBuiltInValue))
);
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
const arrayFindCallGetter: CallGetter = (callConfig, { fixed_eval, fixed_trace, m }) => {
    if (!isPropertyAccessExpression(callConfig.node.expression)) {
        return unimplementedBottom(`Expected a property access expression ${printNodeAndPos(callConfig.node.expression)}`);
    }

    const array = Config({ node: callConfig.node.expression.expression, env: callConfig.env });
    const arrayElements = getElementNodesOfArrayValuedNode(array, { fixed_eval, fixed_trace, m });
    return configSetJoinMap(arrayElements, fixed_eval);
}

type ElementAccessGetter = (consConfig: BuiltInConfig, args: { fixed_eval: FixedEval, fixed_trace: FixedTrace, m: number, expressionBuiltInValue: BuiltInValue }) => ConfigSet
const arrayConcatEAG: ElementAccessGetter = (consConfig, { fixed_eval, fixed_trace, m }) => {
    const thisArrayConsConfigs = getCallExpressionExpressionOfValue(consConfig, 'Array#concat', { fixed_eval });
    const thisArrayElemConfigs = configSetJoinMap(thisArrayConsConfigs, consConfig => getElementNodesOfArrayValuedNode(consConfig, { fixed_eval, fixed_trace, m }));
    const thisArrayElemConses = configSetJoinMap(thisArrayElemConfigs, fixed_eval);

    if (!isCallExpression(consConfig.node)) {
        return unimplementedBottom(`Expected ${printNodeAndPos(consConfig.node)} to be a call expression`)
    }

    if (consConfig.node.arguments.length !== 1) {
        return unimplementedBottom(`Expected a single argument ${printNodeAndPos(consConfig.node)}`)
    }

    const argConfig = Config({ node: consConfig.node.arguments[0], env: consConfig.env });
    const argElements = getElementNodesOfArrayValuedNode(argConfig, { fixed_eval, fixed_trace, m });
    const argElemConses = configSetJoinMap(argElements, argElem => resolvePromisesOfNode(argElem, fixed_eval));
    return join(thisArrayElemConses, argElemConses);
}
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
function originalArrayEAG(builtInValue: BuiltInValue): ElementAccessGetter {
    return (consConfig, { fixed_eval, fixed_trace, m }) => {
        const thisArrayConsConfigs = getCallExpressionExpressionOfValue(consConfig, builtInValue, { fixed_eval });
        const thisArrayElemConfigs = configSetJoinMap(thisArrayConsConfigs, consConfig => getElementNodesOfArrayValuedNode(consConfig, { fixed_eval, fixed_trace, m }));
        const thisArrayElemConses = configSetJoinMap(thisArrayElemConfigs, fixed_eval);
        return thisArrayElemConses;
    }
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
const promiseAllEAG: ElementAccessGetter = (consConfig, { fixed_eval, fixed_trace, m }) => {
    if (!isCallExpression(consConfig.node)) {
        return unimplementedBottom(`Expected ${printNodeAndPos(consConfig.node)} to be a call expression`)
    }

    if (consConfig.node.arguments.length !== 1) {
        return unimplementedBottom(`Expected a single argument ${printNodeAndPos(consConfig.node)}`)
    }

    const argConfig = Config({ node: consConfig.node.arguments[0], env: consConfig.env });
    const argElements = getElementNodesOfArrayValuedNode(argConfig, { fixed_eval, fixed_trace, m });
    return configSetJoinMap(argElements, argElem => resolvePromisesOfNode(argElem, fixed_eval));
}
function getCallExpressionExpressionOfValue(consConfig: BuiltInConfig, val: BuiltInValue, { fixed_eval }: { fixed_eval: FixedEval }): ConfigSet {
    const { node: cons, env } = consConfig;
    if (!isCallExpression(cons)) {
        return unimplementedBottom(`Expected ${printNodeAndPos(cons)} to be a call expression`);
    }
    const funcExpression = cons.expression;
    const funcConfigs = fixed_eval(Config({ node: funcExpression, env }));
    return configSetJoinMap(funcConfigs, funcConfig => {
        if (!isPropertyAccessConfig(funcConfig) || funcConfig.builtInValue !== val) {
            return empty();
        }
        const { node: cons, env: funcEnv } = funcConfig;
        return fixed_eval(Config({ node: cons.expression, env: funcEnv }));
    });
}

const builtInElementPick: ElementAccessGetter = (config, { expressionBuiltInValue }) => {
    return singleConfig(
        createElementPickConfig(config)
        .set('builtInValue', getElementAccessBuiltInValue(expressionBuiltInValue))
    );
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
    proto: null,
};

const builtInValues = ['Array', 'Array#concat', 'Array#concat()',
    'Array#filter', 'Array#filter()', 'Array#find',
    'Array#forEach', 'Array#forEach()', 'Array#includes', 'Array#includes()',
    'Array#indexOf', 'Array#indexOf()',
    'Array#join', 'Array#join()', 'Array#map', 'Array#map()', 'Array#push', 'Array#push()', 'Array#reduce',
    'Array#slice', 'Array#slice()', 'Array#some', 'Array#some()',
    'Array.from', 'Array.isArray', 'Array.isArray()',
    'Boolean', 'Boolean()',
    'Buffer', 'Buffer.from', 'Buffer.from()',
    'Date', 'Date#getTime', 'Date#getTime()', 'Date#toISOString', 'Date#toISOString()',
    'Date#toLocaleDateString', 'Date#toLocaleDateString()', 'Date#toLocaleString', 'Date#toLocaleString()',
    'Date.now', 'Date.now()', 'Date.UTC',
    'Error',
    'JSON', 'JSON.parse', 'JSON.stringify', 'JSON.stringify()',
    'Map', 'Map#delete', 'Map#delete()', 'Map#get', 'Map#has', 'Map#has()', 'Map#keys', 'Map#keys()',
    'Map#set', 'Map#set()',
    'Math', 'Math.floor', 'Math.floor()',
    'Number', 'Number()', 'Number#toFixed', 'Number#toFixed()', 'Number#toString', 'Number#toString()',
    'Number.isNaN', 'Number.isNaN()', 'Number.parseInt', 'Number.parseInt()',
    'Object', 'Object.assign', 'Object.fromEntries', 'Object.fromEntries()',
    'Object.entries', 'Object.entries()', 'Object.entries()[]',
    'Object.freeze', 'Object.keys', 'Object.keys()', 'Object.values', 'Object.values()',
    'Promise', 'Promise#then', 'Promise#then()', 'Promise.all', 'Promise.all()', 'Promise.allSettled',
    'Promise.allSettled()', 'Promise.resolve', 'Promise.resolve()',
    'RegExp#test', 'RegExp#test()',
    'String', 'String#endsWith', 'String#endsWith()', 'String#includes', 'String#includes()',
    'String#match', 'String#match()', 'String#replace', 'String#replace()',
    'String#slice', 'String#slice()',
    'String#split', 'String#split()', 'String#split()[]',
    'String#substring', 'String#substring()', 'String#toLowerCase', 'String#toLowerCase()',
    'String#trim', 'String#trim()',
    'URL', 'URL#href', 'URL#searchParams', 'URL#toString', 'URL#toString()',
    'URLSearchParams', 'URLSearchParams#set', 'URLSearchParams#set()',
    'URLSearchParams#toString', 'URLSearchParams#toString()',
    'console', 'console.info', 'console.info()', 'console.log', 'console.log()',
    'console.error', 'console.error()',
    'console.table', 'console.table()', 'console.warn', 'console.warn()',
    'fetch', 'isNaN', 'isNaN()', 'parseInt', 'parseInt()', 'parseFloat', 'parseFloat()',
    'process', 'process.cwd', 'process.cwd()', 'process.env', 'process.env[]',
    'setTimeout', 'setTimeout()',
    'undefined',
] as const;
export type BuiltInValue = typeof builtInValues[number];

export const builtInValueBehaviors: { [k in BuiltInValue] : BuiltInValueBehavior} = {
    'Array': builtInObject(['Array.from', 'Array.isArray']),
    'Array#concat': builtInFunction(),
    'Array#concat()': arrayValued(arrayConcatEAG),
    'Array#filter': standardArrayMethod(),
    'Array#filter()': arrayValued(originalArrayEAG('Array#filter')),
    'Array#find': { ...standardArrayMethod(), resultOfCalling: arrayFindCallGetter },
    'Array#forEach': standardArrayMethod(),
    'Array#forEach()': bottomBehavior,
    'Array#includes': builtInFunction(),
    'Array#includes()': bottomBehavior,
    'Array#indexOf': builtInFunction(),
    'Array#indexOf()': proto('Number'),
    'Array#join': builtInFunction(),
    'Array#join()': proto('String'),
    'Array#map': standardArrayMethod(),
    'Array#map()': arrayValued(arrayMapEAG),
    'Array#push': builtInFunction(),
    'Array#push()': bottomBehavior, // TODO
    'Array#reduce': {... bottomBehavior, resultOfCalling: arrayReduceCallGetter, higherOrderArgs: zeroth, primopBinderGetter: arrayReduceABG },
    'Array#slice': builtInFunction(),
    'Array#slice()': arrayValued(originalArrayEAG('Array#slice')),
    'Array#some': standardArrayMethod(),
    'Array#some()': bottomBehavior,
    'Array.from': { ...bottomBehavior, resultOfCalling: arrayFromCallGetter },
    'Array.isArray': builtInFunction(),
    'Array.isArray()': bottomBehavior, // TODO
    'Boolean': callableObject(),
    'Boolean()': bottomBehavior, // TODO
    'Buffer': builtInObject(['Buffer.from']),
    'Buffer.from': builtInFunction(),
    'Buffer.from()': bottomBehavior, // TODO
    'Date': builtInObject(['Date.now', 'Date.UTC']),
    'Date#getTime': builtInFunction(),
    'Date#getTime()': bottomBehavior, // TODO
    'Date#toISOString': builtInFunction(),
    'Date#toISOString()': bottomBehavior, // TODO
    'Date#toLocaleDateString': builtInFunction(),
    'Date#toLocaleDateString()': proto('String'),
    'Date#toLocaleString': builtInFunction(),
    'Date#toLocaleString()': bottomBehavior, // TODO
    'Date.now': builtInFunction(),
    'Date.now()': proto('Date'),
    'Date.UTC': builtInFunction(),
    'Error': builtInObject(),
    'JSON': builtInObject(['JSON.parse', 'JSON.stringify']),
    'JSON.parse': { ...bottomBehavior, resultOfCalling: () => justExtern },
    'JSON.stringify': builtInFunction(),
    'JSON.stringify()': proto('String'),
    'Map': builtInObject(),
    'Map#delete': builtInFunction(),
    'Map#delete()': bottomBehavior, // TODO
    'Map#get': { ...bottomBehavior, resultOfCalling: mapGetCallGetter },
    'Map#has': builtInFunction(),
    'Map#has()': bottomBehavior, // TODO
    'Map#keys': builtInFunction(),
    'Map#keys()': arrayValued(mapKeysEAG),
    'Map#set': builtInFunction(),
    'Map#set()': bottomBehavior, // TODO
    'Math': builtInObject(['Math.floor']),
    'Math.floor': builtInFunction(),
    'Math.floor()': proto('Number'),
    'Number': callableObject(['Number.isNaN', 'Number.parseInt']),
    'Number()': proto('Number'),
    'Number#toFixed': builtInFunction(),
    'Number#toFixed()': bottomBehavior, // TODO
    'Number#toString': builtInFunction(),
    'Number#toString()': bottomBehavior, // TODO
    'Number.isNaN': builtInFunction(),
    'Number.isNaN()': bottomBehavior, // TODO
    'Number.parseInt': builtInFunction(),
    'Number.parseInt()': proto('Number'),
    'Object': builtInObject(['Object.assign', 'Object.fromEntries', 'Object.entries', 'Object.freeze', 'Object.keys', 'Object.values']),
    'Object.assign': builtInFunction(),
    'Object.fromEntries': builtInFunction(),
    'Object.fromEntries()': bottomBehavior, // TODO
    'Object.entries': builtInFunction(),
    'Object.entries()': arrayValued(builtInElementPick),
    'Object.entries()[]': bottomBehavior,
    'Object.freeze': builtInFunction(),
    'Object.keys': builtInFunction(),
    'Object.keys()': bottomBehavior, // TODO
    'Object.values': builtInFunction(),
    'Object.values()': arrayValued(objectValuesEAG),
    'Promise': builtInObject(['Promise.all', 'Promise.allSettled', 'Promise.resolve']),
    'Promise#then': builtInFunction({ primopBinderGetter: promiseThenABG, higherOrderArgs: zeroth }),
    'Promise#then()': bottomBehavior, // TODO
    'Promise.all': builtInFunction(),
    'Promise.all()': arrayValued(promiseAllEAG),
    'Promise.allSettled': builtInFunction(),
    'Promise.allSettled()': bottomBehavior,
    'Promise.resolve': builtInFunction(),
    'Promise.resolve()': proto('Promise'),
    'RegExp#test': builtInFunction(),
    'RegExp#test()': bottomBehavior,
    'String': callableObject(),
    'String#endsWith': builtInFunction(),
    'String#endsWith()': bottomBehavior, // TODO
    'String#includes': builtInFunction(),
    'String#includes()': bottomBehavior,
    'String#match': builtInFunction(),
    'String#match()': bottomBehavior,
    'String#replace': builtInFunction(),
    'String#replace()': proto('String'),
    'String#slice': builtInFunction(),
    'String#slice()': proto('String'),
    'String#split': builtInFunction(),
    'String#split()': arrayValued(builtInElementPick),
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
    'URL#toString': builtInFunction(),
    'URL#toString()': bottomBehavior, // TODO
    'URLSearchParams': builtInObject(),
    'URLSearchParams#set': builtInFunction(),
    'URLSearchParams#set()': bottomBehavior, // TODO
    'URLSearchParams#toString': builtInFunction(),
    'URLSearchParams#toString()': bottomBehavior, // TODO
    'console': builtInObject(['console.info', 'console.log', 'console.error', 'console.table', 'console.warn']),
    'console.info': builtInFunction(),
    'console.info()': bottomBehavior, // TODO
    'console.log': builtInFunction(),
    'console.log()': bottomBehavior,
    'console.error': builtInFunction(),
    'console.error()': bottomBehavior,
    'console.table': builtInFunction(),
    'console.table()': bottomBehavior, // TODO
    'console.warn': builtInFunction(),
    'console.warn()': bottomBehavior,
    'fetch': { ...bottomBehavior, resultOfCalling: () => justExtern },
    'isNaN': builtInFunction(),
    'isNaN()': bottomBehavior, // TODO
    'parseInt': builtInFunction(),
    'parseInt()': bottomBehavior, // TODO
    'parseFloat': builtInFunction(),
    'parseFloat()': proto('Number'),
    'process': builtInObject(['process.cwd', 'process.env']),
    'process.cwd': builtInFunction(),
    'process.cwd()': proto('String'),
    'process.env': arrayValued(builtInElementPick),
    'process.env[]': proto('String'),
    'setTimeout': builtInFunction({ higherOrderArgs: zeroth }),
    'setTimeout()': bottomBehavior, // TODO
    'undefined': { ...bottomBehavior, resultOfCalling: () => empty() },
}

type BuiltInValueBehavior = {
    resultOfCalling: CallGetter,
    resultOfPropertyAccess: PropertyAccessGetter,
    resultOfElementAccess: ElementAccessGetter,
    primopBinderGetter: PrimopFunctionArgParamBinderGetter,
    higherOrderArgs: number[],
    proto: BuiltInProto | null
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
        resultOfCalling: callExpressionResult,
    }
}

function builtInFunction(args?: Partial<BuiltInValueBehavior>): BuiltInValueBehavior {
    return {
        ...bottomBehavior,
        resultOfCalling: callExpressionResult,
        ...args,
    }
}

function arrayValued(resultOfElementAccess: ElementAccessGetter): BuiltInValueBehavior {
    return {
        ...proto('Array'),
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
        resultOfPropertyAccess: builtInProtoMethod(proto),
        proto,
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

export function isBuiltInConfig(config: Config): config is BuiltInConfig {
    return config.builtInValue !== undefined;
}

export function idIsBuiltIn(id: ts.Identifier): boolean {
    return builtInValues.some(val => val === id.text);
}

type PropertyAccessGetter = (propertyAccessConfig: Config<PropertyAccessExpression>, args: { fixed_eval: FixedEval, expressionBuiltInValue: BuiltInValue }) => ConfigSet;
function builtInStaticMethods(...names: BuiltInValue[]): PropertyAccessGetter {
    const methodNames = names.map(name => name.split('.')[1]);
    return (pac, { fixed_eval, expressionBuiltInValue }) => methodNames.some(methodName => pac.node.name.text === methodName)
        ? singleConfig(pac.set(
            'builtInValue',
            getPropertyAccessBuiltInValue(expressionBuiltInValue, pac.node.name.text)
        ))
        : inaccessibleProperty(pac, { fixed_eval, expressionBuiltInValue });
}
function builtInProtoMethod(typeName: BuiltInProto): PropertyAccessGetter {
    return (pac, { fixed_eval, expressionBuiltInValue }) => {
        const expressionConses = fixed_eval(Config({ node: pac.node.expression, env: pac.env}));
        const isBuiltInProtoMethod = expressionConses.some(consConfig =>
            isConfigNoExtern(consConfig)
            && getPropertyOfProto(typeName, pac.node.name.text, consConfig, pac, fixed_eval).size > 0
        )
        return isBuiltInProtoMethod
            ? singleConfig(pac.set(
                'builtInValue',
                `${typeName}#${pac.node.name.text}` as BuiltInValue
            ))
            : inaccessibleProperty(pac, { fixed_eval, expressionBuiltInValue });
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
            } else if (cons.expression.text === 'Date') {
                return 'Date';
            }
        }
        return 'Object';
    } else if (isBinaryExpression(cons)
        && (cons.operatorToken.kind === SyntaxKind.AsteriskToken
            || cons.operatorToken.kind === SyntaxKind.SlashToken
            || cons.operatorToken.kind === SyntaxKind.PercentToken
        )
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
    const builtInValue = builtInValues.find(val => {
        const [valType, valMethod] = val.split('#');
        return proto === valType && valMethod === propertyName;
    });
    return builtInValue
        ? singleton(accessConfig.set('builtInValue', builtInValue))
        : unimplementedBottom(`Could not find proto value ${printNodeAndPos(accessConfig.node)}`);
}

function getCallBuiltInValue(expressionBuiltInValue: BuiltInValue) {
    const builtInValue = builtInValues.find(biv => biv === expressionBuiltInValue + '()');
    if (builtInValue === undefined) {
        throw new Error(`Could not find call built in value for ${expressionBuiltInValue}`)
    }
    return builtInValue;
}

function getPropertyAccessBuiltInValue(expressionBuiltInValue: BuiltInValue, name: string) {
    const builtInValue = builtInValues.find(biv => biv === `${expressionBuiltInValue}.${name}`);
    if (builtInValue === undefined) {
        throw new Error(`Could not find property access built in value for ${expressionBuiltInValue}`)
    }
    return builtInValue;
}

function getElementAccessBuiltInValue(expressionBuiltInValue: BuiltInValue) {
    const builtInValue = builtInValues.find(biv => biv === expressionBuiltInValue + '[]');
    if (builtInValue === undefined) {
        throw new Error(`Could not find element access built in value for ${expressionBuiltInValue}`)
    }
    return builtInValue;
}
