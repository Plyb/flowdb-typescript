import ts, { CallExpression, PropertyAccessExpression, SyntaxKind } from 'typescript';
import { isArrayLiteralExpression, isBinaryExpression, isCallExpression, isElementAccessExpression, isFunctionLikeDeclaration, isIdentifier, isNewExpression, isPropertyAccessExpression, isRegularExpressionLiteral, isStringLiteral, isTemplateLiteral, printNodeAndPos, SimpleFunctionLikeDeclaration } from './ts-utils';
import { empty, setFilter, setFlatMap, setMap, setSome, singleton } from './setUtil';
import { SimpleSet } from 'typescript-super-set';
import { AnalysisNode, Cursor, isExtern } from './abstract-values';
import { structuralComparator } from './comparators';
import { consList, unimplemented } from './util';
import { FixedEval, FixedTrace } from './dcfa';
import { getAllValuesOf, getElementNodesOfArrayValuedNode, getMapSetCalls, subsumes } from './abstract-value-utils';
import { Config, ConfigSet, justExtern, isConfigNoExtern, isPropertyAccessConfig, pushContext, singleConfig, configSetJoinMap, unimplementedBottom, isObjectLiteralExpressionConfig, isConfigExtern, join, ConfigNoExtern } from './configuration';

type BuiltInConstructor = PropertyAccessExpression | ts.Identifier | ts.CallExpression | ts.ElementAccessExpression;

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
    'Array#reduce': true,
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
    'Date.UTC': true,
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
    'Object.values': true,
    'Object.values()': true,
    'Promise': true,
    'Promise#then': true,
    'Promise.all': true,
    'Promise.all()': true,
    'Promise.allSettled': true,
    'Promise.allSettled()': true,
    'Promise.resolve': true,
    'Promise.resolve()': true,
    'RegExp#test': true,
    'RegExp#test()': true,
    'String': true,
    'String#includes': true,
    'String#includes()': true,
    'String#split': true,
    'String#split()': true,
    'String#split()[]': true,
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
    'console.table': true,
    'console.warn': true,
    'console.warn()': true,
    'fetch': true,
    'isNaN': true,
    'parseFloat': true,
    'undefined': true,
}
type BuiltInValue = keyof typeof builtInValuesObject;
const builtInValues = new SimpleSet<BuiltInValue>(structuralComparator, ...[...Object.keys(builtInValuesObject) as Iterable<BuiltInValue>]);

const builtInProtosObject = {
    'Array': true,
    'Error': true,
    'Map': true,
    'Object': true,
    'Promise': true,
    'RegExp': true,
    'String': true,
}
type BuiltInProto = keyof typeof builtInProtosObject;

/**
 * Given a node that we already know represents some built-in value, which built in value does it represent?
 * Note that this assumes there are no methods that share a name.
 */
export function getBuiltInValueOfBuiltInConstructor(builtInConstructorConfig: Config<BuiltInConstructor>, fixed_eval: FixedEval): BuiltInValue {
    const { node: builtInConstructor, env } = builtInConstructorConfig;

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
    } else if (ts.isElementAccessExpression(builtInConstructor)) {
        const expressionConses = fixed_eval({ node: builtInConstructor.expression, env });
        const expressionBuiltIns = setFlatMap(expressionConses, expressionCons => {
            if (isConfigExtern(expressionCons)) {
                return empty<BuiltInValue>();
            }

            if (!isBuiltInConstructorShapedConfig(expressionCons)) {
                return empty<BuiltInValue>();
            }

            return singleton(getBuiltInValueOfBuiltInConstructor(expressionCons, fixed_eval));
        });
        const builtInValue = expressionBuiltIns.elements.find(expressionBuiltIn => builtInValues.elements.some(biv => biv === expressionBuiltIn + '[]'));
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
        const builtInValues = setMap(builtInConstructorsForExpression, expressionConstructor =>
            getBuiltInValueOfBuiltInConstructor(expressionConstructor, fixed_eval)
        );
        if (builtInValues.size() !== 1) {
            throw new Error(`Expected exactly one built in constructor for expression of ${printNodeAndPos(builtInConstructor)}`);
        }
        return builtInValues.elements[0];
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
        || isElementAccessExpression(node);
}
export function isBuiltInConstructorShapedConfig(config: Config): config is Config<BuiltInConstructor> {
    return isBuiltInConstructorShaped(config.node);
}

function uncallable(name: BuiltInValue) { return () => unimplementedBottom(`No result of calling ${name}`)}
type CallGetter = (callConfig: Config<CallExpression>, args: { fixed_eval: FixedEval, fixed_trace: FixedTrace, m: number }) => ConfigSet
const arrayFromCallGetter: CallGetter = (callConfig, { fixed_eval }) => fixed_eval({
    node: callConfig.node.arguments[0],
    env: callConfig.env,
})
const arrayReduceCallGetter: CallGetter = (callConfig, { fixed_eval, m }) => {
    const accumulatorConses = fixed_eval({ node: callConfig.node.arguments[0], env: callConfig.env });
    const initialConses = fixed_eval({ node: callConfig.node.arguments[1], env: callConfig.env });

    
    const accumulatorResults = configSetJoinMap(accumulatorConses, accumulatorCons => {
        if (!isFunctionLikeDeclaration(accumulatorCons.node)) {
            return unimplementedBottom(`Expected a function ${printNodeAndPos(accumulatorCons.node)}`)
        }
        
        return fixed_eval({ node: accumulatorCons.node.body, env: consList(pushContext(callConfig.node, callConfig.env, m), accumulatorCons.env) });
    })

    return join(initialConses, accumulatorResults);
}
const mapGetCallGetter: CallGetter = (callConfig, { fixed_eval, fixed_trace }) => {
    const mapConses = fixed_eval({ node: callConfig.node.expression, env: callConfig.env });
    const getKeyConses = fixed_eval({ node: callConfig.node.arguments[0], env: callConfig.env });

    const setSiteConfigs = configSetJoinMap(mapConses, mapConsConfig =>
        getMapSetCalls(fixed_trace(mapConsConfig), { fixed_eval })
    );
    return configSetJoinMap(setSiteConfigs, siteConfig => {
        const setKeyArg = (siteConfig.node as CallExpression).arguments[0];
        const setKeyConses = fixed_eval({ node: setKeyArg, env: siteConfig.env });

        const keyMatch = setSome(getKeyConses, getKeyCons => setSome(setKeyConses, setKeyCons =>
            subsumes(getKeyCons.node, setKeyCons.node) || subsumes(setKeyCons.node, getKeyCons.node)
        ))
        if (keyMatch) {
            const setValueArg = (siteConfig.node as CallExpression).arguments[1];
            return fixed_eval({ node: setValueArg, env: siteConfig.env });
        } else {
            return empty();
        }
    });
}
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
    'Array#reduce': arrayReduceCallGetter,
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
    'Date.UTC': singleConfig,
    'JSON': uncallable('JSON'),
    'JSON.parse': () => justExtern,
    'JSON.stringify': singleConfig,
    'JSON.stringify()': uncallable('JSON.stringify()'),
    'Map#get': mapGetCallGetter,
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
    'Object.values': singleConfig,
    'Object.values()': uncallable('Object.values()'),
    'Promise': uncallable('Promise'),
    'Promise#then': singleConfig,
    'Promise.all': singleConfig,
    'Promise.all()': uncallable('Promise.all()'),
    'Promise.allSettled': singleConfig,
    'Promise.allSettled()': uncallable('Promise.allSettled()'),
    'Promise.resolve': singleConfig,
    'Promise.resolve()': uncallable('Promise.resolve()'),
    'RegExp#test': singleConfig,
    'RegExp#test()': uncallable('RegExp#test()'),
    'String': singleConfig,
    'String#includes': singleConfig,
    'String#includes()': uncallable('String#includes()'),
    'String#match': singleConfig,
    'String#match()': uncallable('String#match()'),
    'String#split': singleConfig,
    'String#split()': uncallable('String#split()'),
    'String#split()[]': uncallable('String#split()[]'),
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
    'console.table': singleConfig,
    'console.warn': singleConfig,
    'console.warn()': uncallable('console.warn()'),
    'fetch': () => justExtern,
    'isNaN': singleConfig,
    'parseFloat': singleConfig,
    'undefined': uncallable('undefined'),
}

export function idIsBuiltIn(id: ts.Identifier): boolean {
    return builtInValues.elements.some(val => val === id.text);
}

type PropertyAccessGetter = (propertyAccessConfig: Config<PropertyAccessExpression>, args: { fixed_eval: FixedEval }) => ConfigSet;
const inaccessibleProperty: PropertyAccessGetter = ({ node: pa }) => unimplementedBottom(`Unable to get property ${printNodeAndPos(pa)}`) ;
function builtInStaticMethod(name: BuiltInValue): PropertyAccessGetter {
    const [_, methodName] = name.split('.');
    return (pac, { fixed_eval}) => pac.node.name.text === methodName
        ? singleConfig(pac)
        : inaccessibleProperty(pac, { fixed_eval });
}
function builtInStaticMethods(...names: BuiltInValue[]): PropertyAccessGetter {
    const methodNames = names.map(name => name.split('.')[1]);
    return (pac, { fixed_eval }) => methodNames.some(methodName => pac.node.name.text === methodName)
        ? singleConfig(pac)
        : inaccessibleProperty(pac, { fixed_eval });
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
            : inaccessibleProperty(pac, { fixed_eval });
    }
}
export const resultOfPropertyAccess: { [K in BuiltInValue]: PropertyAccessGetter } = {
    'Array': builtInStaticMethod('Array.from'),
    'Array#filter': inaccessibleProperty,
    'Array#filter()': builtInProtoMethod('Array'),
    'Array#find': inaccessibleProperty,
    'Array#forEach': inaccessibleProperty,
    'Array#includes': inaccessibleProperty,
    'Array#includes()': inaccessibleProperty,
    'Array#indexOf': inaccessibleProperty,
    'Array#indexOf()': inaccessibleProperty,
    'Array#join': inaccessibleProperty,
    'Array#join()': builtInProtoMethod('String'),
    'Array#map': inaccessibleProperty,
    'Array#map()': builtInProtoMethod('Array'),
    'Array#reduce': inaccessibleProperty,
    'Array#slice': inaccessibleProperty,
    'Array#slice()': builtInProtoMethod('Array'),
    'Array#some': inaccessibleProperty,
    'Array#some()': inaccessibleProperty,
    'Array.from': inaccessibleProperty,
    'Buffer': builtInStaticMethod('Buffer.from'),
    'Buffer.from': inaccessibleProperty,
    'Date': builtInStaticMethods('Date.now', 'Date.UTC'),
    'Date.now': inaccessibleProperty,
    'Date.now()': inaccessibleProperty,
    'Date.UTC': inaccessibleProperty,
    'JSON': builtInStaticMethods('JSON.parse', 'JSON.stringify'),
    'JSON.parse': inaccessibleProperty,
    'JSON.stringify': inaccessibleProperty,
    'JSON.stringify()': builtInProtoMethod('String'),
    'Map#get': inaccessibleProperty,
    'Map#keys': inaccessibleProperty,
    'Map#keys()': builtInProtoMethod('Array'),
    'Map#set': inaccessibleProperty,
    'Math': builtInStaticMethod('Math.floor'),
    'Math.floor': inaccessibleProperty,
    'Math.floor()': inaccessibleProperty,
    'Object': builtInStaticMethods('Object.assign', 'Object.entries', 'Object.freeze', 'Object.keys', 'Object.values'),
    'Object.assign': inaccessibleProperty,
    'Object.entries': inaccessibleProperty,
    'Object.entries()': builtInProtoMethod('Array'),
    'Object.freeze': inaccessibleProperty,
    'Object.keys': inaccessibleProperty,
    'Object.values': inaccessibleProperty,
    'Object.values()': builtInProtoMethod('Array'),
    'Promise': builtInStaticMethods('Promise.all', 'Promise.allSettled', 'Promise.resolve'),
    'Promise#then': inaccessibleProperty,
    'Promise.all': inaccessibleProperty,
    'Promise.all()': inaccessibleProperty,
    'Promise.allSettled': inaccessibleProperty,
    'Promise.allSettled()': inaccessibleProperty,
    'Promise.resolve': inaccessibleProperty,
    'Promise.resolve()': builtInProtoMethod('Promise'),
    'RegExp#test': inaccessibleProperty,
    'RegExp#test()': inaccessibleProperty,
    'String': inaccessibleProperty,
    'String#includes': inaccessibleProperty,
    'String#includes()': inaccessibleProperty,
    'String#match': inaccessibleProperty,
    'String#match()': inaccessibleProperty,
    'String#split': inaccessibleProperty,
    'String#split()': builtInProtoMethod('Array'),
    'String#split()[]': builtInProtoMethod('String'),
    'String#substring': inaccessibleProperty,
    'String#substring()': builtInProtoMethod('String'),
    'String#toLowerCase': inaccessibleProperty,
    'String#toLowerCase()': builtInProtoMethod('String'),
    'String#trim': inaccessibleProperty,
    'String#trim()': builtInProtoMethod('String'),
    'console': builtInStaticMethods('console.log', 'console.error', 'console.table', 'console.warn'),
    'console.log': inaccessibleProperty,
    'console.log()': inaccessibleProperty,
    'console.error': inaccessibleProperty,
    'console.error()': inaccessibleProperty,
    'console.table': inaccessibleProperty,
    'console.warn': inaccessibleProperty,
    'console.warn()': inaccessibleProperty,
    'fetch': inaccessibleProperty,
    'isNaN': inaccessibleProperty,
    'parseFloat': inaccessibleProperty,
    'undefined': () => empty(),
}

type ElementAccessGetter = (consConfig: Config<BuiltInConstructor>, args: { accessConfig: Config<ts.ElementAccessExpression> | undefined, fixed_eval: FixedEval, fixed_trace: FixedTrace, m: number }) => ConfigSet
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
        return fixed_eval({ node: keyArg, env: siteConfig.env });
    });
}
const objectValuesEAG: ElementAccessGetter = (consConfig, { fixed_eval, fixed_trace }) => {
    if (!ts.isCallExpression(consConfig.node)) {
        return unimplementedBottom(`Expected ${printNodeAndPos(consConfig.node)} to be a call expression`)
    }

    if (consConfig.node.arguments.length !== 1) {
        return unimplementedBottom(`Expected a single argument ${printNodeAndPos(consConfig.node)}`)
    }

    const argConfig = { node: consConfig.node.arguments[0], env: consConfig.env };
    return configSetJoinMap(fixed_eval(argConfig), objectConsConfig => {
        if (!isObjectLiteralExpressionConfig(objectConsConfig)) {
            return unimplementedBottom(`Expected an object literal ${printNodeAndPos(objectConsConfig.node)}`)
        }
        return getAllValuesOf(objectConsConfig, fixed_eval, fixed_trace);
    })

}
function getCallExpressionExpressionOfValue(consConfig: Config<BuiltInConstructor>, val: BuiltInValue, { fixed_eval }: { fixed_eval: FixedEval }): ConfigSet {
    const { node: cons, env } = consConfig;
    if (!ts.isCallExpression(cons)) {
        return unimplementedBottom(`Expected ${printNodeAndPos(cons)} to be a call expression`);
    }
    const funcExpression = cons.expression;
    const funcConfigs = fixed_eval({ node: funcExpression, env });
    return configSetJoinMap(funcConfigs, funcConfig => {
        if (!isPropertyAccessConfig(funcConfig) || getBuiltInValueOfBuiltInConstructor(funcConfig, fixed_eval) !== val) {
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
    'Array#reduce': inaccessibleElement,
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
    'Date.UTC': inaccessibleElement,
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
    'Object.values': inaccessibleElement,
    'Object.values()': objectValuesEAG,
    'Promise': inaccessibleElement,
    'Promise#then': inaccessibleElement,
    'Promise.all': inaccessibleElement,
    'Promise.all()': inaccessibleElement, // TODO
    'Promise.allSettled': inaccessibleElement,
    'Promise.allSettled()': inaccessibleElement,
    'Promise.resolve': inaccessibleElement,
    'Promise.resolve()': inaccessibleElement,
    'RegExp#test': inaccessibleElement,
    'RegExp#test()': inaccessibleElement,
    'String': inaccessibleElement,
    'String#includes': inaccessibleElement,
    'String#includes()': inaccessibleElement,
    'String#match': inaccessibleElement,
    'String#match()': inaccessibleElement,
    'String#split': inaccessibleElement,
    'String#split()': (_, { accessConfig }) => accessConfig === undefined ? unimplementedBottom(`Need an element access`) : singleConfig(accessConfig),
    'String#split()[]': inaccessibleElement,
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
    'console.table': inaccessibleElement,
    'console.warn': inaccessibleElement,
    'console.warn()': inaccessibleElement,
    'fetch': inaccessibleElement,
    'isNaN': inaccessibleElement,
    'parseFloat': inaccessibleElement,
    'undefined': inaccessibleElement,
}

/**
 * @param cons here we're assuming a constructor that isn't "built in"
 */
export function getProtoOf(cons: AnalysisNode): BuiltInProto | null {
    if (isStringLiteral(cons) || isTemplateLiteral(cons)) {
        return 'String';
    } else if (isRegularExpressionLiteral(cons)) {
        return 'RegExp';
    } else if (isArrayLiteralExpression(cons)) {
        return 'Array';
    } else if (isNewExpression(cons)) {
        if (ts.isIdentifier(cons.expression)) {
            if (cons.expression.text === 'Map') {
                return 'Map';
            } else if (cons.expression.text === 'Error') {
                return 'Error';
            }
        }
        return 'Object';
    } else if (isBinaryExpression(cons)
        && (cons.operatorToken.kind === SyntaxKind.AsteriskToken || cons.operatorToken.kind === SyntaxKind.SlashToken)
    ) {
        return 'Object'; // I don't have use for a number proto right now, so we're using Object as the most general placeholder
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


type PrimopFunctionArgParamBinderGetter = (this: Config<ts.Expression> | undefined, primopArgIndex: number, argParameterIndex: number, callSite: Config<ts.CallExpression>, args: { fixed_eval: FixedEval, fixed_trace: FixedTrace, m: number }) => ConfigSet;
type PrimopBinderGetters = { [K in BuiltInValue]: PrimopFunctionArgParamBinderGetter }
const notSupported = (name: BuiltInValue) => () => unimplementedBottom(`Unimplemented function arg param binder getter for ${name}`);
const arrayMapABG: PrimopFunctionArgParamBinderGetter = function(primopArgIndex, argParameterIndex, _, { fixed_eval, fixed_trace, m }): ConfigSet {
    if (this === undefined) {
        throw new Error();
    }
    
    if (primopArgIndex != 0 || argParameterIndex != 0) {
        return empty();
    }
    return getElementNodesOfArrayValuedNode(this, { fixed_eval, fixed_trace, m });
}
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
const arrayForEachABG: PrimopFunctionArgParamBinderGetter = function(primopArgIndex, argParameterIndex, callSite, { fixed_eval, fixed_trace, m }) {
    if (this === undefined) {
        return unimplementedBottom(`Cannot call forEach on undefined`);
    }

    if (primopArgIndex !== 0) {
        return unimplementedBottom(`Cannot get binding for function passed as argument ${primopArgIndex} to Array#forEach`);
    }

    if (argParameterIndex === 0) {
        return getElementNodesOfArrayValuedNode(this, { fixed_eval, fixed_trace, m })
    } else {
        return unimplementedBottom(`Unknown arg parameter index ${argParameterIndex} for function passed to Array#forEach ${printNodeAndPos(callSite.node)}`)
    }
}
export const primopBinderGetters: PrimopBinderGetters = {
    'Array': notSupported('Array'),
    'Array#filter': notSupported('Array#filter'),
    'Array#filter()': notSupported('Array#filter()'),
    'Array#find': notSupported('Array#find'),
    'Array#forEach': arrayForEachABG,
    'Array#includes': notSupported('Array#includes'),
    'Array#includes()': notSupported('Array#includes()'),
    'Array#indexOf': notSupported('Array#indexOf'),
    'Array#indexOf()': notSupported('Array#indexOf()'),
    'Array#join': notSupported('Array#join'),
    'Array#join()': notSupported('Array#join()'),
    'Array#map': arrayMapABG,
    'Array#map()': notSupported('Array'),
    'Array#reduce': arrayReduceABG,
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
    'Date.UTC': notSupported('Date.UTC'),
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
    'Object.keys': notSupported('Object.keys'),
    'Object.values': notSupported('Object.values'),
    'Object.values()': notSupported('Object.values()'),
    'Promise': notSupported('Promise'),
    'Promise#then': notSupported('Promise#then'), // TODO
    'Promise.all': notSupported('Promise.all'),
    'Promise.all()': notSupported('Promise.all()'),
    'Promise.allSettled': notSupported('Promise.allSettled'),
    'Promise.allSettled()': notSupported('Promise.allSettled()'),
    'Promise.resolve': notSupported('Promise.resolve'),
    'Promise.resolve()': notSupported('Promise.resolve()'),
    'RegExp#test': notSupported('RegExp#test'),
    'RegExp#test()': notSupported('RegExp#test()'),
    'String': notSupported('String'),
    'String#includes': notSupported('String#includes'),
    'String#includes()': notSupported('String#includes()'),
    'String#match': notSupported('String#match'),
    'String#match()': notSupported('String#match()'),
    'String#split': notSupported('String#split'),
    'String#split()': notSupported('String#split()'),
    'String#split()[]': notSupported('String#split()[]'),
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
    'console.table': notSupported('console.table'),
    'console.warn': notSupported('console.warn'),
    'console.warn()': notSupported('console.warn()'),
    'fetch': notSupported('fetch'),
    'isNaN': notSupported('isNaN'),
    'parseFloat': notSupported('parseFloat'),
    'undefined': notSupported('undefined'),
}

type HigherOrderArgs = { [K in BuiltInValue]: number[] }
const none = []
const zeroth = [0];
export const higherOrderArgsOf: HigherOrderArgs = {
    'Array': none,
    'Array#filter': zeroth,
    'Array#filter()': none,
    'Array#find': zeroth,
    'Array#forEach': zeroth,
    'Array#includes': zeroth,
    'Array#includes()': none,
    'Array#indexOf': none,
    'Array#indexOf()': none,
    'Array#join': none,
    'Array#join()': none,
    'Array#map': zeroth,
    'Array#map()': none,
    'Array#reduce': zeroth,
    'Array#slice': none,
    'Array#slice()': none,
    'Array#some': zeroth,
    'Array#some()': none,
    'Array.from': none,
    'Buffer': none,
    'Buffer.from': none,
    'Date': none,
    'Date.UTC': none,
    'Date.now': none,
    'Date.now()': none,
    'JSON': none,
    'JSON.parse': none,
    'JSON.stringify': none,
    'JSON.stringify()': none,
    'Map#get': none,
    'Map#keys': none,
    'Map#keys()': none,
    'Map#set': none,
    'Math': none,
    'Math.floor': none,
    'Math.floor()': none,
    'Object': none,
    'Object.assign': none,
    'Object.entries': none,
    'Object.entries()': none,
    'Object.freeze': none,
    'Object.keys': none,
    'Object.values': none,
    'Object.values()': none,
    'Promise': none,
    'Promise#then': zeroth,
    'Promise.all': none,
    'Promise.all()': none,
    'Promise.allSettled': none,
    'Promise.allSettled()': none,
    'Promise.resolve': none,
    'Promise.resolve()': none,
    'RegExp#test': none,
    'RegExp#test()': none,
    'String': none,
    'String#includes': none,
    'String#includes()': none,
    'String#match': none,
    'String#match()': none,
    'String#split': none,
    'String#split()': none,
    'String#split()[]': none,
    'String#substring': none,
    'String#substring()': none,
    'String#toLowerCase': none,
    'String#toLowerCase()': none,
    'String#trim': none,
    'String#trim()': none,
    'console': none,
    'console.error': none,
    'console.error()': none,
    'console.log': none,
    'console.log()': none,
    'console.table': none,
    'console.warn': none,
    'console.warn()': none,
    'fetch': none,
    'isNaN': none,
    'parseFloat': none,
    'undefined': none,
}