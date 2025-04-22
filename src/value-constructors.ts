import ts, { CallExpression, PropertyAccessExpression, SyntaxKind } from 'typescript';
import { isFunctionLikeDeclaration, printNodeAndPos, SimpleFunctionLikeDeclaration } from './ts-utils';
import { empty, setFilter, singleton } from './setUtil';
import { SimpleSet } from 'typescript-super-set';
import { Cursor, isExtern } from './abstract-values';
import { structuralComparator } from './comparators';
import { consList, unimplemented } from './util';
import { FixedEval, FixedTrace } from './dcfa';
import { getElementNodesOfArrayValuedNode, getMapSetCalls } from './abstract-value-utils';
import { Config, ConfigSet, justExtern, isConfigNoExtern, isPropertyAccessConfig, pushContext, singleConfig, configSetJoinMap, unimplementedBottom } from './configuration';

type BuiltInConstructor = PropertyAccessExpression | ts.Identifier | ts.CallExpression;

const builtInValuesObject = {
    'Array': true,
    'Array#filter': true,
    'Array#filter()': true,
    'Array#find': true,
    'Array#forEach': true,
    'Array#includes': true,
    'Array#includes()': true,
    'Array#indexOf': true,
    'Array#indexOf()': true,
    'Array#join': true,
    'Array#join()': true,
    'Array#map': true,
    'Array#map()': true,
    'Array#slice': true,
    'Array#slice()': true,
    'Array#some': true,
    'Array#some()': true,
    'Array.from': true,
    'Buffer': true,
    'Buffer.from': true,
    'Date': true,
    'Date.now': true,
    'Date.now()': true,
    'JSON': true,
    'JSON.parse': true,
    'JSON.stringify': true,
    'JSON.stringify()': true,
    'Map#get': true,
    'Map#keys': true,
    'Map#keys()': true,
    'Map#set': true,
    'Math': true,
    'Math.floor': true,
    'Math.floor()': true,
    'Object': true,
    'Object.assign': true,
    'Object.entries': true,
    'Object.entries()': true,
    'Object.freeze': true,
    'Object.keys': true,
    'Promise': true,
    'Promise.all': true,
    'Promise.all()': true,
    'Promise.allSettled': true,
    'Promise.allSettled()': true,
    'RegExp#test': true,
    'RegExp#test()': true,
    'String#includes': true,
    'String#includes()': true,
    'String#split': true,
    'String#split()': true,
    'String#substring': true,
    'String#substring()': true,
    'String#toLowerCase': true,
    'String#toLowerCase()': true,
    'String#trim': true,
    'String#trim()': true,
    'String#match': true,
    'String#match()': true,
    'console': true,
    'console.log': true,
    'console.log()': true,
    'console.error': true,
    'console.error()': true,
    'console.warn': true,
    'console.warn()': true,
    'fetch': true,
    'parseFloat': true,
    'undefined': true,
    '%ParameterSourced': true,
}
type BuiltInValue = keyof typeof builtInValuesObject;
const builtInValues = new SimpleSet<BuiltInValue>(structuralComparator, ...[...Object.keys(builtInValuesObject) as Iterable<BuiltInValue>]);

const builtInProtosObject = {
    'Array': true,
    'Error': true,
    'Map': true,
    'Object': true,
    'RegExp': true,
    'String': true,
}
type BuiltInProto = keyof typeof builtInProtosObject;

/**
 * Given a node that we already know represents some built-in value, which built in value does it represent?
 * Note that this assumes there are no methods that share a name.
 */
export function getBuiltInValueOfBuiltInConstructor(builtInConstructorConfig: Config<BuiltInConstructor>, fixed_eval: FixedEval, targetFunction: SimpleFunctionLikeDeclaration): BuiltInValue {
    const { node: builtInConstructor, env } = builtInConstructorConfig;
    if (isParamSourced(builtInConstructorConfig, fixed_eval, targetFunction)) {
        return '%ParameterSourced';
    }

    if (ts.isPropertyAccessExpression(builtInConstructor)) {
        const methodName = builtInConstructor.name.text;
        const builtInValue = builtInValues.elements.find(val =>
            typeof val === 'string' && (val.split('#')[1] === methodName || val.split('.')[1] === methodName)
        );
        assertNotUndefined(builtInValue);
        return builtInValue;
    } else if (ts.isIdentifier(builtInConstructor)) {
        const builtInValue = builtInValues.elements.find(val => val === builtInConstructor.text);
        assertNotUndefined(builtInValue);
        return builtInValue;
    } else { // call expression
        const expressionBuiltInValue = getBuiltInValueOfExpression(builtInConstructorConfig as Config<ts.CallExpression>);
        const builtInValue = builtInValues.elements.find(val =>
            typeof val === 'string' && val.includes('()') && val.split('()')[0] === expressionBuiltInValue
        );
        assertNotUndefined(builtInValue);
        return builtInValue;
    }

    function getBuiltInValueOfExpression(callConfig: Config<ts.CallExpression>): BuiltInValue {
        const expressionConses = fixed_eval({
            node: callConfig.node.expression,
            env: callConfig.env,
        });
        const builtInConstructorsForExpression = setFilter(
            expressionConses,
            isBuiltInConstructorShapedConfig
        );
        if (builtInConstructorsForExpression.size() !== 1) {
            throw new Error(`Expected exactly one built in constructor for expression of ${printNodeAndPos(builtInConstructor)}`);
        }
        const expressionConstructor = builtInConstructorsForExpression.elements[0];
        return getBuiltInValueOfBuiltInConstructor(expressionConstructor, fixed_eval, targetFunction);
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

    return ts.isPropertyAccessExpression(node)
        || ts.isIdentifier(node)
        || ts.isCallExpression(node);
}
export function isBuiltInConstructorShapedConfig(config: Config): config is Config<BuiltInConstructor> {
    return isBuiltInConstructorShaped(config.node);
}

function uncallable(name: BuiltInValue) { return () => unimplementedBottom(`No result of calling ${name}`)}
type CallGetter = (callConfig: Config<CallExpression>, args: { fixed_eval: FixedEval }) => ConfigSet
const arrayFromCallGetter: CallGetter = (callConfig, { fixed_eval }) => fixed_eval({
    node: callConfig.node.arguments[0],
    env: callConfig.env,
})
export const resultOfCalling: { [K in BuiltInValue]: CallGetter } = {
    'Array': uncallable('Array'),
    'Array#filter': singleConfig,
    'Array#filter()': uncallable('Array#filter()'),
    'Array#find': uncallable('Array#find'), // TODO
    'Array#forEach': singleConfig,
    'Array#includes': singleConfig,
    'Array#includes()': uncallable('Array#includes()'),
    'Array#indexOf': singleConfig,
    'Array#indexOf()': uncallable('Array#indexOf()'),
    'Array#join': singleConfig,
    'Array#join()': uncallable('Array#join()'),
    'Array#map': singleConfig,
    'Array#map()': uncallable('Array#map()'),
    'Array#slice': singleConfig,
    'Array#slice()': uncallable('Array#slice()'),
    'Array#some': singleConfig,
    'Array#some()': uncallable('Array#some()'),
    'Array.from': arrayFromCallGetter,
    'Buffer': uncallable('Buffer'),
    'Buffer.from': singleConfig,
    'Date': uncallable('Date'),
    'Date.now': singleConfig,
    'Date.now()': uncallable('Date.now()'),
    'JSON': uncallable('JSON'),
    'JSON.parse': () => justExtern,
    'JSON.stringify': singleConfig,
    'JSON.stringify()': uncallable('JSON.stringify()'),
    'Map#get': uncallable('Map#get'), // TODO
    'Map#keys': singleConfig,
    'Map#keys()': uncallable('Map#keys()'),
    'Map#set': uncallable('Map#set'), // TODO
    'Math': uncallable('Math'),
    'Math.floor': singleConfig,
    'Math.floor()': uncallable('Math.floor()'),
    'Object': uncallable('Object'),
    'Object.assign': uncallable('Object.assign'), // TODO
    'Object.entries': singleConfig,
    'Object.entries()': uncallable('Object.entries()'),
    'Object.freeze': uncallable('Object.freeze'), // TODO
    'Object.keys': singleConfig,
    'Promise': uncallable('Promise'),
    'Promise.all': singleConfig,
    'Promise.all()': uncallable('Promise.all()'),
    'Promise.allSettled': singleConfig,
    'Promise.allSettled()': uncallable('Promise.allSettled()'),
    'RegExp#test': singleConfig,
    'RegExp#test()': uncallable('RegExp#test()'),
    'String#includes': singleConfig,
    'String#includes()': uncallable('String#includes()'),
    'String#match': singleConfig,
    'String#match()': uncallable('String#match()'),
    'String#split': singleConfig,
    'String#split()': uncallable('String#split()'),
    'String#substring': singleConfig,
    'String#substring()': uncallable('String#substring()'),
    'String#toLowerCase': singleConfig,
    'String#toLowerCase()': uncallable('String#toLowerCase()'),
    'String#trim': singleConfig,
    'String#trim()': uncallable('String#trim()'),
    'console': uncallable('console'),
    'console.log': singleConfig,
    'console.log()': uncallable('console.log()'),
    'console.error': singleConfig,
    'console.error()': uncallable('console.error()'),
    'console.warn': singleConfig,
    'console.warn()': uncallable('console.warn()'),
    'fetch': () => justExtern,
    'parseFloat': singleConfig,
    'undefined': uncallable('undefined'),
    '%ParameterSourced': singleConfig
}

export function idIsBuiltIn(id: ts.Identifier): boolean {
    return builtInValues.elements.some(val => val === id.text);
}

type PropertyAccessGetter = (propertyAccessConfig: Config<PropertyAccessExpression>, args: { fixed_eval: FixedEval }) => ConfigSet;
function inaccessibleProperty(name: BuiltInValue | BuiltInProto): PropertyAccessGetter {
    return ({ node: pa }) => unimplementedBottom(`Unable to get property ${name}.${pa.name.text}`) 
}
function builtInStaticMethod(name: BuiltInValue): PropertyAccessGetter {
    const [typeName, methodName] = name.split('.');
    return (pac, { fixed_eval}) => pac.node.name.text === methodName
        ? singleConfig(pac)
        : inaccessibleProperty(typeName as BuiltInValue)(pac, { fixed_eval });
}
function builtInStaticMethods(...names: BuiltInValue[]): PropertyAccessGetter {
    const [typeName] = names[0].split('.');
    const methodNames = names.map(name => name.split('.')[1]);
    return (pac, { fixed_eval }) => methodNames.some(methodName => pac.node.name.text === methodName)
        ? singleConfig(pac)
        : inaccessibleProperty(typeName as BuiltInValue)(pac, { fixed_eval });
}
function builtInProtoMethod(typeName: BuiltInProto): PropertyAccessGetter {
    return (pac, { fixed_eval }) => {
        const expressionConses = fixed_eval({ node: pac.node.expression, env: pac.env});
        const isBuiltInProtoMethod = expressionConses.elements.some(consConfig =>
            isConfigNoExtern(consConfig)
            && getPropertyOfProto(typeName, pac.node.name.text, consConfig, pac, fixed_eval).size() > 0
        )
        return isBuiltInProtoMethod
            ? singleConfig(pac)
            : inaccessibleProperty(typeName)(pac, { fixed_eval });
    }
}
export const resultOfPropertyAccess: { [K in BuiltInValue]: PropertyAccessGetter } = {
    'Array': builtInStaticMethod('Array.from'),
    'Array#filter': inaccessibleProperty('Array#filter'),
    'Array#filter()': builtInProtoMethod('Array'),
    'Array#find': inaccessibleProperty('Array#find'),
    'Array#forEach': inaccessibleProperty('Array#forEach'),
    'Array#includes': inaccessibleProperty('Array#includes'),
    'Array#includes()': inaccessibleProperty('Array#includes()'),
    'Array#indexOf': inaccessibleProperty('Array#indexOf'),
    'Array#indexOf()': inaccessibleProperty('Array#indexOf()'),
    'Array#join': inaccessibleProperty('Array#join'),
    'Array#join()': builtInProtoMethod('String'),
    'Array#map': inaccessibleProperty('Array#map'),
    'Array#map()': builtInProtoMethod('Array'),
    'Array#slice': inaccessibleProperty('Array#slice'),
    'Array#slice()': builtInProtoMethod('Array'),
    'Array#some': inaccessibleProperty('Array#some'),
    'Array#some()': inaccessibleProperty('Array#some()'),
    'Array.from': inaccessibleProperty('Array.from'),
    'Buffer': builtInStaticMethod('Buffer.from'),
    'Buffer.from': inaccessibleProperty('Buffer.from'),
    'Date': builtInStaticMethod('Date.now'),
    'Date.now': inaccessibleProperty('Date.now'),
    'Date.now()': inaccessibleProperty('Date.now()'),
    'JSON': builtInStaticMethods('JSON.parse', 'JSON.stringify'),
    'JSON.parse': inaccessibleProperty('JSON.parse'),
    'JSON.stringify': inaccessibleProperty('JSON.stringify'),
    'JSON.stringify()': builtInProtoMethod('String'),
    'Map#get': inaccessibleProperty('Map#get'),
    'Map#keys': inaccessibleProperty('Map#keys'),
    'Map#keys()': builtInProtoMethod('Array'),
    'Map#set': inaccessibleProperty('Map#set'),
    'Math': builtInStaticMethod('Math.floor'),
    'Math.floor': inaccessibleProperty('Math.floor'),
    'Math.floor()': inaccessibleProperty('Math.floor()'),
    'Object': builtInStaticMethods('Object.assign', 'Object.entries', 'Object.freeze', 'Object.keys'),
    'Object.assign': inaccessibleProperty('Object.assign'),
    'Object.entries': inaccessibleProperty('Object.entries'),
    'Object.entries()': builtInProtoMethod('Array'),
    'Object.freeze': inaccessibleProperty('Object.freeze'),
    'Object.keys': inaccessibleProperty('Object.keys'),
    'Promise': builtInStaticMethods('Promise.all', 'Promise.allSettled'),
    'Promise.all': inaccessibleProperty('Promise.all'),
    'Promise.all()': inaccessibleProperty('Promise.all()'),
    'Promise.allSettled': inaccessibleProperty('Promise.allSettled'),
    'Promise.allSettled()': inaccessibleProperty('Promise.allSettled()'),
    'RegExp#test': inaccessibleProperty('RegExp#test'),
    'RegExp#test()': inaccessibleProperty('RegExp#test()'),
    'String#includes': inaccessibleProperty('String#includes'),
    'String#includes()': inaccessibleProperty('String#includes()'),
    'String#match': inaccessibleProperty('String#match'),
    'String#match()': inaccessibleProperty('String#match()'),
    'String#split': inaccessibleProperty('String#split'),
    'String#split()': builtInProtoMethod('Array'),
    'String#substring': inaccessibleProperty('String#substring'),
    'String#substring()': builtInProtoMethod('String'),
    'String#toLowerCase': inaccessibleProperty('String#toLowerCase'),
    'String#toLowerCase()': builtInProtoMethod('String'),
    'String#trim': inaccessibleProperty('String#trim'),
    'String#trim()': builtInProtoMethod('String'),
    'console': builtInStaticMethods('console.log', 'console.error', 'console.warn'),
    'console.log': inaccessibleProperty('console.log'),
    'console.log()': inaccessibleProperty('console.log()'),
    'console.error': inaccessibleProperty('console.error'),
    'console.error()': inaccessibleProperty('console.error()'),
    'console.warn': inaccessibleProperty('console.warn'),
    'console.warn()': inaccessibleProperty('console.warn()'),
    'fetch': inaccessibleProperty('fetch'),
    'parseFloat': inaccessibleProperty('parseFloat'),
    'undefined': () => empty(),
    '%ParameterSourced': singleConfig,
}

type ElementAccessGetter = (consConfig: Config<BuiltInConstructor>, args: { fixed_eval: FixedEval, fixed_trace: FixedTrace, targetFunction: SimpleFunctionLikeDeclaration, m: number }) => ConfigSet
const inaccessibleElement: ElementAccessGetter = ({ node }) =>
    unimplementedBottom(`Unable to get element of ${printNodeAndPos(node)}`);
const arrayMapEAG: ElementAccessGetter = (consConfig, { fixed_eval, m }) => {
    const { node: cons, env } = consConfig;
    if (!ts.isCallExpression(cons)) {
        return unimplementedBottom(`Expected ${printNodeAndPos(cons)} to be a call expression`);
    }
    const argFuncs = fixed_eval({ node: cons.arguments[0], env });
    return configSetJoinMap(argFuncs, funcConfig => {
        const { node: func, env: funcEnv } = funcConfig;
        if (!isFunctionLikeDeclaration(func)) {
            return unimplementedBottom(`Expected ${printNodeAndPos(func)} to be a function`);
        }
        return fixed_eval({ node: func.body, env: consList(pushContext(cons, env, m), funcEnv)});
    })
}
const arrayFilterEAG: ElementAccessGetter = (consConfig, { fixed_eval, fixed_trace, targetFunction, m }) => {
    const thisArrayConsConfigs = getCallExpressionExpressionOfValue(consConfig, 'Array#filter', { fixed_eval, targetFunction });
    return configSetJoinMap(thisArrayConsConfigs, consConfig => getElementNodesOfArrayValuedNode(consConfig, { fixed_eval, fixed_trace, targetFunction, m }));
}
const mapKeysEAG: ElementAccessGetter = (consConfig, { fixed_eval, fixed_trace, targetFunction }) => {
    const thisMapConsConfigs = getCallExpressionExpressionOfValue(consConfig, 'Map#keys', { fixed_eval, targetFunction });
    const setSiteConfigs = configSetJoinMap(thisMapConsConfigs, mapConsConfig =>
        getMapSetCalls(fixed_trace(mapConsConfig), { fixed_eval, targetFunction })
    );
    return configSetJoinMap(setSiteConfigs, siteConfig => {
        const keyArg = (siteConfig.node as CallExpression).arguments[0];
        return fixed_eval({ node: keyArg, env: siteConfig.env });
    });
}
function getCallExpressionExpressionOfValue(consConfig: Config<BuiltInConstructor>, val: BuiltInValue, { fixed_eval, targetFunction }: { fixed_eval: FixedEval, targetFunction: SimpleFunctionLikeDeclaration }): ConfigSet {
    const { node: cons, env } = consConfig;
    if (!ts.isCallExpression(cons)) {
        return unimplementedBottom(`Expected ${printNodeAndPos(cons)} to be a call expression`);
    }
    const funcExpression = cons.expression;
    const funcConfigs = fixed_eval({ node: funcExpression, env });
    return configSetJoinMap(funcConfigs, funcConfig => {
        if (!isPropertyAccessConfig(funcConfig) || getBuiltInValueOfBuiltInConstructor(funcConfig, fixed_eval, targetFunction) !== val) {
            return empty();
        }
        const { node: cons, env: funcEnv } = funcConfig;
        return fixed_eval({ node: cons.expression, env: funcEnv });
    });
}
export const resultOfElementAccess: { [K in BuiltInValue]: ElementAccessGetter } = {
    'Array': inaccessibleElement,
    'Array#filter': inaccessibleElement,
    'Array#filter()': arrayFilterEAG,
    'Array#find': inaccessibleElement,
    'Array#forEach': inaccessibleElement,
    'Array#includes': inaccessibleElement,
    'Array#includes()': inaccessibleElement,
    'Array#indexOf': inaccessibleElement,
    'Array#indexOf()': inaccessibleElement,
    'Array#join': inaccessibleElement,
    'Array#join()': inaccessibleElement,
    'Array#map': inaccessibleElement,
    'Array#map()': arrayMapEAG,
    'Array#slice': inaccessibleElement,
    'Array#slice()': inaccessibleElement, // TODO
    'Array#some': inaccessibleElement,
    'Array#some()': inaccessibleElement,
    'Array.from': inaccessibleElement,
    'Buffer': inaccessibleElement,
    'Buffer.from': inaccessibleElement,
    'Date': inaccessibleElement,
    'Date.now': inaccessibleElement,
    'Date.now()': inaccessibleElement,
    'JSON': inaccessibleElement,
    'JSON.parse': inaccessibleElement,
    'JSON.stringify': inaccessibleElement,
    'JSON.stringify()': inaccessibleElement,
    'Map#get': inaccessibleElement,
    'Map#keys': inaccessibleElement,
    'Map#keys()': mapKeysEAG,
    'Map#set': inaccessibleElement,
    'Math': inaccessibleElement,
    'Math.floor': inaccessibleElement,
    'Math.floor()': inaccessibleElement,
    'Object': inaccessibleElement,
    'Object.assign': inaccessibleElement,
    'Object.freeze': inaccessibleElement,
    'Object.entries': inaccessibleElement,
    'Object.entries()': inaccessibleElement, // TODO
    'Object.keys': inaccessibleElement,
    'Promise': inaccessibleElement,
    'Promise.all': inaccessibleElement,
    'Promise.all()': inaccessibleElement, // TODO
    'Promise.allSettled': inaccessibleElement,
    'Promise.allSettled()': inaccessibleElement,
    'RegExp#test': inaccessibleElement,
    'RegExp#test()': inaccessibleElement,
    'String#includes': inaccessibleElement,
    'String#includes()': inaccessibleElement,
    'String#match': inaccessibleElement,
    'String#match()': inaccessibleElement,
    'String#split': inaccessibleElement,
    'String#split()': inaccessibleElement,
    'String#substring': inaccessibleElement,
    'String#substring()': inaccessibleElement,
    'String#toLowerCase': inaccessibleElement,
    'String#toLowerCase()': inaccessibleElement,
    'String#trim': inaccessibleElement,
    'String#trim()': inaccessibleElement,
    'console': inaccessibleElement,
    'console.log': inaccessibleElement,
    'console.log()': inaccessibleElement,
    'console.error': inaccessibleElement,
    'console.error()': inaccessibleElement,
    'console.warn': inaccessibleElement,
    'console.warn()': inaccessibleElement,
    'fetch': inaccessibleElement,
    'parseFloat': inaccessibleElement,
    'undefined': inaccessibleElement,
    '%ParameterSourced': inaccessibleElement, // TODO
}

/**
 * @param cons here we're assuming a constructor that isn't "built in"
 */
export function getProtoOf(cons: ts.Node): BuiltInProto | null {
    if (ts.isStringLiteral(cons) || ts.isTemplateLiteral(cons)) {
        return 'String';
    } else if (ts.isRegularExpressionLiteral(cons)) {
        return 'RegExp';
    } else if (ts.isArrayLiteralExpression(cons)) {
        return 'Array';
    } else if (ts.isNewExpression(cons)) {
        if (ts.isIdentifier(cons.expression)) {
            if (cons.expression.text === 'Map') {
                return 'Map';
            } else if (cons.expression.text === 'Error') {
                return 'Error';
            }
        }
        return 'Object';
    } else if (ts.isBinaryExpression(cons)
        && (cons.operatorToken.kind === SyntaxKind.AsteriskToken || cons.operatorToken.kind === SyntaxKind.SlashToken)
    ) {
        return 'Object'; // I don't have use for a number proto right now, so we're using Object as the most general placeholder
    }
    return unimplemented(`Unable to get type for ${printNodeAndPos(cons)}`, null);
}

export function getPropertyOfProto(proto: BuiltInProto, propertyName: string, expressionConsConfig: Config<ts.Node>, accessConfig: Config<ts.PropertyAccessExpression>, fixed_eval: FixedEval): ConfigSet {
    const { node: expressionCons, env: expressionConsEnv } = expressionConsConfig;
    if (proto === 'Error' && propertyName === 'message') { // special case this for now. If we need more special properties, we'll find those later.
        if (!ts.isNewExpression(expressionCons) || expressionCons.arguments === undefined) {
            return unimplementedBottom(`Expected ${printNodeAndPos(expressionCons)} to be a new Error expression with defined arguments`);
        }
        if (expressionCons.arguments.length > 0) {
            return fixed_eval({ node: expressionCons.arguments[0], env: expressionConsEnv });
        }
        return empty();
    }
    const builtInValueExists = builtInValues.elements.some(val => {
        const [valType, valMethod] = val.split('#');
        return proto === valType && valMethod === propertyName;
    });
    return builtInValueExists
        ? singleton(accessConfig)
        : empty();
}


type PrimopFunctionArgParamBinderGetter = (this: Config<ts.Expression> | undefined, primopArgIndex: number, argParameterIndex: number, args: { fixed_eval: FixedEval, fixed_trace: FixedTrace, targetFunction: SimpleFunctionLikeDeclaration, m: number }) => ConfigSet;
type PrimopBinderGetters = { [K in BuiltInValue]: PrimopFunctionArgParamBinderGetter }
const notSupported = (name: BuiltInValue) => () => unimplementedBottom(`Unimplemented function arg param binder getter for ${name}`);
export const primopBinderGetters: PrimopBinderGetters = {
    'Array': notSupported('Array'),
    'Array#filter': notSupported('Array#filter'),
    'Array#filter()': notSupported('Array#filter()'),
    'Array#find': notSupported('Array#find'),
    'Array#forEach': notSupported('Array#forEach'),
    'Array#includes': notSupported('Array#includes'),
    'Array#includes()': notSupported('Array#includes()'),
    'Array#indexOf': notSupported('Array#indexOf'),
    'Array#indexOf()': notSupported('Array#indexOf()'),
    'Array#join': notSupported('Array#join'),
    'Array#join()': notSupported('Array#join()'),
    'Array#map': arrayMapABG,
    'Array#map()': notSupported('Array'),
    'Array#slice': notSupported('Array#slice'),
    'Array#slice()': notSupported('Array#slice()'),
    'Array#some': notSupported('Array#some'),
    'Array#some()': notSupported('Array#some()'),
    'Array.from': notSupported('Array.from'),
    'Buffer': notSupported('Buffer'),
    'Buffer.from': notSupported('Buffer.from'),
    'Date': notSupported('Date'),
    'Date.now': notSupported('Date.now'),
    'Date.now()': notSupported('Date.now()'),
    'JSON': notSupported('JSON'),
    'JSON.parse': notSupported('JSON.parse'),
    'JSON.stringify': notSupported('JSON.stringify'),
    'JSON.stringify()': notSupported('JSON.stringify()'),
    'Map#get': notSupported('Map#get'),
    'Map#keys': notSupported('Map#keys'),
    'Map#keys()': notSupported('Map#keys()'),
    'Map#set': notSupported('Map#set'),
    'Math': notSupported('Math'),
    'Math.floor': notSupported('Math.floor'),
    'Math.floor()': notSupported('Math.floor()'),
    'Object': notSupported('Object'),
    'Object.assign': notSupported('Object.assign'),
    'Object.freeze': notSupported('Object.freeze'),
    'Object.entries': notSupported('Object.entries'),
    'Object.entries()': notSupported('Object.entries()'),
    'Object.keys': notSupported('Object.keys'), // TODO
    'Promise': notSupported('Promise'),
    'Promise.all': notSupported('Promise.all'),
    'Promise.all()': notSupported('Promise.all()'),
    'Promise.allSettled': notSupported('Promise.allSettled'),
    'Promise.allSettled()': notSupported('Promise.allSettled()'),
    'RegExp#test': notSupported('RegExp#test'),
    'RegExp#test()': notSupported('RegExp#test()'),
    'String#includes': notSupported('String#includes'),
    'String#includes()': notSupported('String#includes()'),
    'String#match': notSupported('String#match'),
    'String#match()': notSupported('String#match()'),
    'String#split': notSupported('String#split'),
    'String#split()': notSupported('String#split()'),
    'String#substring': notSupported('String#substring'),
    'String#substring()': notSupported('String#substring()'),
    'String#toLowerCase': notSupported('String#toLowerCase'),
    'String#toLowerCase()': notSupported('String#toLowerCase()'),
    'String#trim': notSupported('String#trim'),
    'String#trim()': notSupported('String#trim()'),
    'console': notSupported('console'),
    'console.log': notSupported('console.log'),
    'console.log()': notSupported('console.log()'),
    'console.error': notSupported('console.error'),
    'console.error()': notSupported('console.error()'),
    'console.warn': notSupported('console.warn'),
    'console.warn()': notSupported('console.warn()'),
    'fetch': notSupported('fetch'),
    'parseFloat': notSupported('parseFloat'),
    'undefined': notSupported('undefined'),
    '%ParameterSourced': notSupported('%ParameterSourced'), // TODO
}
function arrayMapABG(this: Config<ts.Expression> | undefined, primopArgIndex: number, argParameterIndex: number, { fixed_eval, fixed_trace, targetFunction, m }: { fixed_eval: FixedEval, fixed_trace: FixedTrace, targetFunction: SimpleFunctionLikeDeclaration, m: number }): ConfigSet {
    if (this === undefined) {
        throw new Error();
    }
    
    if (primopArgIndex != 0 || argParameterIndex != 0) {
        return empty();
    }
    return getElementNodesOfArrayValuedNode(this, { fixed_eval, fixed_trace, targetFunction, m });
}

function isParamSourced(config: Config<BuiltInConstructor>, fixed_eval: FixedEval, targetFunction: SimpleFunctionLikeDeclaration): boolean {
    const { node, env } = config
    if (ts.isIdentifier(node)) {
        return (ts.isParameter(node.parent) && node.parent.parent === targetFunction)
            || (ts.isParameter(node.parent.parent.parent) && node.parent.parent.parent.parent === targetFunction);
    } else {
        const expressionConses = fixed_eval({ node: node.expression, env });
        const builtInExpressionConses = setFilter(expressionConses, isBuiltInConstructorShapedConfig);
        if (builtInExpressionConses.size() === 0) {
            return false;
        } else if (builtInExpressionConses.size() > 1) {
            return unimplemented(`Currently only handling single built in cons here`, false);
        }
        return isParamSourced(builtInExpressionConses.elements[0], fixed_eval, targetFunction);
    }
}
