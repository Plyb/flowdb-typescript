import ts, { CallExpression, PropertyAccessExpression } from 'typescript';
import { isFunctionLikeDeclaration, NodePrinter, SimpleFunctionLikeDeclaration } from './ts-utils';
import { empty, setFilter } from './setUtil';
import { SimpleSet } from 'typescript-super-set';
import { AbstractValue, botValue, isTop, NodeLatticeElem, nodeLatticeFlatMap, nodeLatticeJoinMap, nodeValue, Top, topValue, unimplementedVal } from './abstract-values';
import { structuralComparator } from './comparators';
import { unimplemented } from './util';
import { FixedEval, FixedTrace } from './dcfa';
import { getElementNodesOfArrayValuedNode, getMapSetCalls } from './abstract-value-utils';

type BuiltInConstructor = PropertyAccessExpression | ts.Identifier | ts.CallExpression;

const builtInValuesObject = {
    'Array': true,
    'Array#filter': true,
    'Array#filter()': true,
    'Array#find': true,
    'Array#includes': true,
    'Array#includes()': true,
    'Array#indexOf': true,
    'Array#indexOf()': true,
    'Array#join': true,
    'Array#join()': true,
    'Array#map': true,
    'Array#map()': true,
    'Array#some': true,
    'Array#some()': true,
    'Array.from': true,
    'Date': true,
    'Date.now': true,
    'Date.now()': true,
    'JSON': true,
    'JSON.parse': true,
    'Map#get': true,
    'Map#keys': true,
    'Map#keys()': true,
    'Map#set': true,
    'Math': true,
    'Math.floor': true,
    'Math.floor()': true,
    'Object': true,
    'Object.assign': true,
    'Object.freeze': true,
    'Object.keys': true,
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
    'undefined': true,
    '%ParameterSourced': true,
}
type BuiltInValue = keyof typeof builtInValuesObject;
const builtInValues = new SimpleSet<BuiltInValue>(structuralComparator, ...[...Object.keys(builtInValuesObject) as Iterable<BuiltInValue>]);

const builtInProtosObject = {
    'Array': true,
    'Map': true,
    'RegExp': true,
    'String': true,
}
type BuiltInProto = keyof typeof builtInProtosObject;

/**
 * Given a node that we already know represents some built-in value, which built in value does it represent?
 * Note that this assumes there are no methods that share a name.
 */
export function getBuiltInValueOfBuiltInConstructor(builtInConstructor: BuiltInConstructor, fixed_eval: FixedEval, printNodeAndPos: NodePrinter, targetFunction: SimpleFunctionLikeDeclaration): BuiltInValue {
    if (isParamSourced(builtInConstructor, fixed_eval, targetFunction)) {
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
        const expressionBuiltInValue = getBuiltInValueOfExpression(builtInConstructor);
        const builtInValue = builtInValues.elements.find(val =>
            typeof val === 'string' && val.includes('()') && val.split('()')[0] === expressionBuiltInValue
        );
        assertNotUndefined(builtInValue);
        return builtInValue;
    }

    function getBuiltInValueOfExpression(call: ts.CallExpression): BuiltInValue {
        const expressionValue = fixed_eval(call.expression);
        const builtInConstructorsForExpression = setFilter(
            expressionValue,
            isBuiltInConstructorShaped
        );
        if (builtInConstructorsForExpression.size() !== 1) {
            throw new Error(`Expected exactly one built in constructor for expression of ${printNodeAndPos(builtInConstructor)}`);
        }
        const expressionConstructor = builtInConstructorsForExpression.elements[0];
        return getBuiltInValueOfBuiltInConstructor(expressionConstructor, fixed_eval, printNodeAndPos, targetFunction);
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
export function isBuiltInConstructorShaped(node: NodeLatticeElem): node is BuiltInConstructor {
    if (isTop(node)) {
        return false;
    }

    return ts.isPropertyAccessExpression(node)
        || ts.isIdentifier(node)
        || ts.isBinaryExpression(node)
        || ts.isCallExpression(node);
}

function uncallable(name: BuiltInValue) { return () => unimplementedVal(`No result of calling ${name}`)}
type CallGetter = (call: CallExpression, args: { fixed_eval: FixedEval }) => AbstractValue
export const resultOfCalling: { [K in BuiltInValue]: CallGetter } = {
    'Array': uncallable('Array'),
    'Array#filter': uncallable('Array#filter'), // TODO
    'Array#filter()': uncallable('Array#filter()'),
    'Array#find': uncallable('Array#find'), // TODO
    'Array#includes': nodeValue,
    'Array#includes()': uncallable('Array#includes()'),
    'Array#indexOf': nodeValue,
    'Array#indexOf()': uncallable('Array#indexOf()'),
    'Array#join': nodeValue,
    'Array#join()': uncallable('Array#join()'),
    'Array#map': nodeValue,
    'Array#map()': uncallable('Array#map()'),
    'Array#some': nodeValue,
    'Array#some()': uncallable('Array#some()'),
    'Array.from': (call, { fixed_eval }) => fixed_eval(call.arguments[0]),
    'Date': uncallable('Date'),
    'Date.now': nodeValue,
    'Date.now()': uncallable('Date.now()'),
    'JSON': uncallable('JSON'),
    'JSON.parse': () => topValue,
    'Map#get': uncallable('Map#get'), // TODO
    'Map#keys': nodeValue,
    'Map#keys()': uncallable('Map#keys()'),
    'Map#set': uncallable('Map#set'), // TODO
    'Math': uncallable('Math'),
    'Math.floor': nodeValue,
    'Math.floor()': uncallable('Math.floor()'),
    'Object': uncallable('Object'),
    'Object.assign': uncallable('Object.assign'), // TODO
    'Object.freeze': uncallable('Object.freeze'), // TODO
    'Object.keys': nodeValue,
    'RegExp#test': nodeValue,
    'RegExp#test()': uncallable('RegExp#test()'),
    'String#includes': nodeValue,
    'String#includes()': uncallable('String#includes()'),
    'String#match': nodeValue,
    'String#match()': uncallable('String#match()'),
    'String#split': nodeValue,
    'String#split()': uncallable('String#split()'),
    'String#substring': nodeValue,
    'String#substring()': uncallable('String#substring()'),
    'String#toLowerCase': nodeValue,
    'String#toLowerCase()': uncallable('String#toLowerCase()'),
    'String#trim': nodeValue,
    'String#trim()': uncallable('String#trim()'),
    'console': uncallable('console'),
    'console.log': nodeValue,
    'console.log()': uncallable('console.log()'),
    'console.error': nodeValue,
    'console.error()': uncallable('console.error()'),
    'console.warn': nodeValue,
    'console.warn()': uncallable('console.warn()'),
    'fetch': () => topValue,
    'undefined': uncallable('undefined'),
    '%ParameterSourced': uncallable('%ParameterSourced'), // TODO
}

export function idIsBuiltIn(id: ts.Identifier): boolean {
    return builtInValues.elements.some(val => val === id.text);
}

type PropertyAccessGetter = (propertyAccess: PropertyAccessExpression) => AbstractValue;
function inaccessibleProperty(name: BuiltInValue | BuiltInProto): PropertyAccessGetter {
    return (pa) => unimplementedVal(`Unable to get property ${name}.${pa.name.text}`) 
}
function builtInStaticMethod(name: BuiltInValue): PropertyAccessGetter {
    const [typeName, methodName] = name.split('.');
    return (pa) => pa.name.text === methodName
        ? nodeValue(pa)
        : inaccessibleProperty(typeName as BuiltInValue)(pa);
}
function builtInStaticMethods(...names: BuiltInValue[]): PropertyAccessGetter {
    const [typeName] = names[0].split('.');
    const methodNames = names.map(name => name.split('.')[1]);
    return (pa) => methodNames.some(methodName => pa.name.text === methodName)
        ? nodeValue(pa)
        : inaccessibleProperty(typeName as BuiltInValue)(pa);
}
function builtInProtoMethod(typeName: BuiltInProto): PropertyAccessGetter {
    return (pa) => {
        const isBuiltInProtoMethod = getBuiltInMethod(typeName, pa.name.text)
        return isBuiltInProtoMethod
            ? nodeValue(pa)
            : inaccessibleProperty(typeName)(pa);
    }
}
export const resultOfPropertyAccess: { [K in BuiltInValue]: PropertyAccessGetter } = {
    'Array': builtInStaticMethod('Array.from'),
    'Array#filter': inaccessibleProperty('Array#filter'),
    'Array#filter()': builtInProtoMethod('Array'),
    'Array#find': inaccessibleProperty('Array#find'),
    'Array#includes': inaccessibleProperty('Array#includes'),
    'Array#includes()': inaccessibleProperty('Array#includes()'),
    'Array#indexOf': inaccessibleProperty('Array#indexOf'),
    'Array#indexOf()': inaccessibleProperty('Array#indexOf()'),
    'Array#join': inaccessibleProperty('Array#join'),
    'Array#join()': builtInProtoMethod('String'),
    'Array#map': inaccessibleProperty('Array#map'),
    'Array#map()': builtInProtoMethod('Array'),
    'Array#some': inaccessibleProperty('Array#some'),
    'Array#some()': inaccessibleProperty('Array#some()'),
    'Array.from': inaccessibleProperty('Array.from'),
    'Date': builtInStaticMethod('Date.now'),
    'Date.now': inaccessibleProperty('Date.now'),
    'Date.now()': inaccessibleProperty('Date.now()'),
    'JSON': builtInStaticMethod('JSON.parse'),
    'JSON.parse': inaccessibleProperty('JSON.parse'),
    'Map#get': inaccessibleProperty('Map#get'),
    'Map#keys': inaccessibleProperty('Map#keys'),
    'Map#keys()': builtInProtoMethod('Array'),
    'Map#set': inaccessibleProperty('Map#set'),
    'Math': builtInStaticMethod('Math.floor'),
    'Math.floor': inaccessibleProperty('Math.floor'),
    'Math.floor()': inaccessibleProperty('Math.floor()'),
    'Object': builtInStaticMethods('Object.assign', 'Object.freeze', 'Object.keys'),
    'Object.assign': inaccessibleProperty('Object.assign'),
    'Object.freeze': inaccessibleProperty('Object.freeze'),
    'Object.keys': inaccessibleProperty('Object.keys'),
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
    'undefined': inaccessibleProperty('undefined'),
    '%ParameterSourced': nodeValue,
}

type ElementAccessGetter = (cons: BuiltInConstructor, args: { fixed_eval: FixedEval, fixed_trace: FixedTrace, printNodeAndPos: NodePrinter, targetFunction: SimpleFunctionLikeDeclaration }) => AbstractValue
const inaccessibleElement: ElementAccessGetter = (cons, { printNodeAndPos }) =>
    unimplementedVal(`Unable to get element of ${printNodeAndPos(cons)}`);
const arrayMapEAG: ElementAccessGetter = (cons, { fixed_eval, printNodeAndPos }) => {
    if (!ts.isCallExpression(cons)) {
        return unimplementedVal(`Expected ${printNodeAndPos(cons)} to be a call expression`);
    }
    const argFuncs = fixed_eval(cons.arguments[0]);
    return nodeLatticeJoinMap(argFuncs, func => {
        if (!isFunctionLikeDeclaration(func)) {
            return unimplementedVal(`Expected ${printNodeAndPos(func)} to be a function`);
        }
        return fixed_eval(func.body);
    })
}
const arrayFilterEAG: ElementAccessGetter = (cons, { fixed_eval, fixed_trace, printNodeAndPos, targetFunction }) => {
    const thisArrayConses = getCallExpressionExpressionOfValue(cons, 'Array#filter', { fixed_eval, printNodeAndPos, targetFunction });
    return nodeLatticeJoinMap(thisArrayConses, cons => getElementNodesOfArrayValuedNode(cons, { fixed_eval, fixed_trace, printNodeAndPos, targetFunction }));
}
const mapKeysEAG: ElementAccessGetter = (cons, { fixed_eval, fixed_trace, printNodeAndPos, targetFunction }) => {
    const thisMapConses = getCallExpressionExpressionOfValue(cons, 'Map#keys', { fixed_eval, printNodeAndPos, targetFunction });
    const setSites = nodeLatticeFlatMap(thisMapConses, mapCons =>
        getMapSetCalls(fixed_trace(mapCons), { fixed_eval, printNodeAndPos, targetFunction })
    );
    return nodeLatticeJoinMap(setSites, site => {
        const keyArg = (site as CallExpression).arguments[0];
        return fixed_eval(keyArg)
    });
}
function getCallExpressionExpressionOfValue(cons: BuiltInConstructor, val: BuiltInValue, { fixed_eval, printNodeAndPos, targetFunction }: { fixed_eval: FixedEval, printNodeAndPos: NodePrinter, targetFunction: SimpleFunctionLikeDeclaration }) {
    if (!ts.isCallExpression(cons)) {
        return unimplementedVal(`Expected ${printNodeAndPos(cons)} to be a call expression`);
    }
    const funcExpression = cons.expression;
    const funcs = fixed_eval(funcExpression);
    return nodeLatticeJoinMap(funcs, cons => {
        if (!ts.isPropertyAccessExpression(cons) || getBuiltInValueOfBuiltInConstructor(cons, fixed_eval, printNodeAndPos, targetFunction) !== val) {
            return botValue;
        }
        return fixed_eval(cons.expression);
    });
}
export const resultOfElementAccess: { [K in BuiltInValue]: ElementAccessGetter } = {
    'Array': inaccessibleElement,
    'Array#filter': inaccessibleElement,
    'Array#filter()': arrayFilterEAG,
    'Array#find': inaccessibleElement,
    'Array#includes': inaccessibleElement,
    'Array#includes()': inaccessibleElement,
    'Array#indexOf': inaccessibleElement,
    'Array#indexOf()': inaccessibleElement,
    'Array#join': inaccessibleElement,
    'Array#join()': inaccessibleElement,
    'Array#map': inaccessibleElement,
    'Array#map()': arrayMapEAG,
    'Array#some': inaccessibleElement,
    'Array#some()': inaccessibleElement,
    'Array.from': inaccessibleElement,
    'Date': inaccessibleElement,
    'Date.now': inaccessibleElement,
    'Date.now()': inaccessibleElement,
    'JSON': inaccessibleElement,
    'JSON.parse': inaccessibleElement,
    'Map#get': inaccessibleElement,
    'Map#keys': inaccessibleElement,
    'Map#keys()': mapKeysEAG,
    'Map#set': inaccessibleElement,
    'Math': inaccessibleElement,
    'Math.floor': inaccessibleElement,
    'Math.floor()': inaccessibleElement,
    'Object': inaccessibleElement,
    'Object.freeze': inaccessibleElement,
    'Object.assign': inaccessibleElement,
    'Object.keys': inaccessibleElement,
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
    'undefined': inaccessibleElement,
    '%ParameterSourced': inaccessibleElement, // TODO
}

/**
 * @param cons here we're assuming a constructor that isn't "built in"
 */
export function getProtoOf(cons: ts.Node, printNodeAndPos: NodePrinter): BuiltInProto | null {
    if (ts.isStringLiteral(cons) || ts.isTemplateLiteral(cons)) {
        return 'String';
    } else if (ts.isRegularExpressionLiteral(cons)) {
        return 'RegExp';
    } else if (ts.isArrayLiteralExpression(cons)) {
        return 'Array';
    } else if (ts.isNewExpression(cons)) {
        if (!(ts.isIdentifier(cons.expression) && cons.expression.text === 'Map')) {
            return unimplemented(`New expression not yet implemented for ${printNodeAndPos(cons.expression)}`, null);
        }
        return 'Map';
    }
    return unimplemented(`Unable to get type for ${printNodeAndPos(cons)}`, null);
}

export function getBuiltInMethod(proto: BuiltInProto, methodName: string) {
    return builtInValues.elements.find(val => {
        const [valType, valMethod] = val.split('#');
        return proto === valType && valMethod === methodName;
    });
}


type PrimopFunctionArgParamBinderGetter = (this: ts.Expression | undefined, primopArgIndex: number, argParameterIndex: number, args: { fixed_eval: FixedEval, fixed_trace: FixedTrace, printNodeAndPos: NodePrinter, targetFunction: SimpleFunctionLikeDeclaration }) => AbstractValue;
type PrimopBinderGetters = { [K in BuiltInValue]: PrimopFunctionArgParamBinderGetter }
const getBot = () => botValue;
const notSupported = (name: BuiltInValue) => () => unimplementedVal(`Unimplemented function arg param binder getter for ${name}`);
export const primopBinderGetters: PrimopBinderGetters = {
    'Array': notSupported('Array'),
    'Array#filter': notSupported('Array#filter'),
    'Array#filter()': notSupported('Array#filter()'),
    'Array#find': notSupported('Array#find'),
    'Array#includes': notSupported('Array#includes'),
    'Array#includes()': notSupported('Array#includes()'),
    'Array#indexOf': notSupported('Array#indexOf'),
    'Array#indexOf()': notSupported('Array#indexOf()'),
    'Array#join': notSupported('Array#join'),
    'Array#join()': notSupported('Array#join()'),
    'Array#map': arrayMapABG,
    'Array#map()': notSupported('Array'),
    'Array#some': notSupported('Array#some'),
    'Array#some()': notSupported('Array#some()'),
    'Array.from': notSupported('Array.from'),
    'Date': notSupported('Date'),
    'Date.now': notSupported('Date.now'),
    'Date.now()': notSupported('Date.now()'),
    'JSON': notSupported('JSON'),
    'JSON.parse': notSupported('JSON.parse'),
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
    'Object.keys': notSupported('Object.keys'), // TODO
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
    'undefined': notSupported('undefined'),
    '%ParameterSourced': notSupported('%ParameterSourced'), // TODO
}
function arrayMapABG(this: ts.Expression | undefined, primopArgIndex: number, argParameterIndex: number, { fixed_eval, fixed_trace, printNodeAndPos, targetFunction }: { fixed_eval: FixedEval, fixed_trace: FixedTrace, printNodeAndPos: NodePrinter, targetFunction: SimpleFunctionLikeDeclaration }) {
    if (this === undefined) {
        throw new Error();
    }
    
    if (primopArgIndex != 0 || argParameterIndex != 0) {
        return empty<NodeLatticeElem>();
    }
    return getElementNodesOfArrayValuedNode(this, { fixed_eval, fixed_trace, printNodeAndPos, targetFunction });
}

function isParamSourced(node: BuiltInConstructor, fixed_eval: FixedEval, targetFunction: SimpleFunctionLikeDeclaration): boolean {
    if (ts.isIdentifier(node)) {
        return ts.isParameter(node.parent) && node.parent.parent === targetFunction;
    } else {
        const expressionConses = fixed_eval(node.expression);
        const builtInExpressionConses = setFilter(expressionConses, cons => isBuiltInConstructorShaped(cons));
        if (builtInExpressionConses.size() === 0) {
            return false;
        } else if (builtInExpressionConses.size() > 1) {
            return unimplemented(`Currently only handling single built in cons here`, false);
        }
        return isParamSourced(builtInExpressionConses.elements[0], fixed_eval, targetFunction);
    }
}
