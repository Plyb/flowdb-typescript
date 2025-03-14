import ts, { BinaryOperator, CallExpression, SyntaxKind } from 'typescript';
import { AbstractResult, anyObjectResult, arrayResult, botResult, join, objectResult, primopResult, promiseResult, result, resultBind, resultBind2, resultFrom, setJoinMap, topResult } from './abstract-results';
import { AbstractValue, anyBooleanValue, anyDateValue, anyNumberValue, ArrayRef, booleanValue, botValue, FlatLatticeKey, MapRef, nullValue, numberValue, primopValue, stringValue, subsumes, top } from './abstract-values';
import { structuralComparator } from './comparators';
import { SimpleSet } from 'typescript-super-set';
import { empty, setFilter, setMap, setSift, singleton } from './setUtil';
import { FixRunFunc } from './fixpoint';
import { SimpleFunctionLikeDeclaration } from './ts-utils';
import { id } from './util';
import { cloneNode } from 'ts-clone-node';

export type PrimopId = keyof Primops;
type Primops = typeof primops
export type FixedEval = (node: ts.Node) => AbstractResult;
export type FixedTrace = (node: ts.Node) => AbstractResult;
export type PrimopExpression = ts.CallExpression | ts.BinaryExpression;
type Primop = (expression: PrimopExpression, fixed_eval: FixedEval, fixed_trace: FixedTrace, ...args: AbstractResult[]) => AbstractResult

const mathFloorPrimop = createUnaryPrimop('numbers', resultFrom(numberValue), Math.floor);
const stringIncludesPrimop =
    createUnaryPrimopWithThis('strings', resultFrom(booleanValue), String.prototype.includes);
const stringSubstringPrimop =
    createBinaryPrimopWithThisHetero('strings', 'numbers', resultFrom(stringValue),
        String.prototype.substring
    );
const stringSplitPrimop =
    createUnaryPrimopWithThis('strings',
        (arr, expression) =>
            arrayResult(
                expression,
                setJoinMap(new SimpleSet(structuralComparator, ...arr), resultFrom(stringValue))
            ),
        String.prototype.substring
    );
const stringTrimPrimop =
    createNullaryPrimopWithThis('strings', resultFrom(stringValue), String.prototype.trim);
const stringToLowerCasePrimop =
    createNullaryPrimopWithThis('strings', resultFrom(stringValue), String.prototype.toLowerCase);
const fetchPrimop: Primop =
    createUnaryPrimop('strings',
        (_, expression) =>
            promiseResult(expression, anyObjectResult),
        () => null
    );
const jsonParsePrimop = createUnaryPrimop('strings', () => topResult, () => null);
const dateNowPrimop = (() => result(anyDateValue)) as Primop;
const stringMatchPrimop = createUnaryPrimopWithThisHetero('strings', 'regexps',
    (arr, expression) =>
        arrayResult(
            expression,
            setJoinMap(new SimpleSet(structuralComparator, ...arr!), resultFrom(stringValue))
        ),
    String.prototype.match
)
function arrayMapPrimop(expression: PrimopExpression, fixed_eval: FixedEval, _: FixedTrace, arg: AbstractResult): AbstractResult {
    const elementResult = setJoinMap(arg.value.nodes, func => fixed_eval((func as SimpleFunctionLikeDeclaration).body));
    return arrayResult(expression, elementResult);
}
function arrayFilterPrimop(this: AbstractResult, expression: PrimopExpression): AbstractResult {
    const elementResult = resultBind<ArrayRef>(this, 'arrays', arrRef => {
        const abstractArray = this.arrayStore.get(arrRef);
        if (abstractArray === undefined) {
            throw new Error('expected arr to be present in store');
        }
        return {
            ...this,
            value: abstractArray.element
        }
    })
    return arrayResult(expression, elementResult);
}
const arrayIndexOf = (() => result(anyNumberValue)) as Primop;
const arraySome = (() => result(anyBooleanValue)) as Primop;
const arrayIncludes = (() => result(anyBooleanValue)) as Primop;
function arrayFindPrimop(this: AbstractResult): AbstractResult {
    const elementResult = resultBind<ArrayRef>(this, 'arrays', arrRef => {
        const abstractArray = this.arrayStore.get(arrRef);
        if (abstractArray === undefined) {
            throw new Error('expected arr to be present in store');
        }
        return {
            ...this,
            value: abstractArray.element
        }
    })
    return elementResult;
}
function mapKeysPrimop(this: AbstractResult, _: PrimopExpression, fixed_eval: FixedEval, fixed_trace: FixedTrace): AbstractResult {
    return resultBind<MapRef>(this, 'maps', (ref) => {
        const setSites = getMapSetCalls(fixed_trace(ref).value.nodes, fixed_eval);
        return setJoinMap(setSites, site => {
            const keyArg = site.arguments[0];
            return fixed_eval(keyArg)
        });
    })
}
function mapGetPrimop(this: AbstractResult, _: PrimopExpression, fixed_eval: FixedEval, fixed_trace: FixedTrace, key: AbstractResult): AbstractResult {
    return resultBind<MapRef>(this, 'maps', (ref) => {
        const setSites = getMapSetCalls(fixed_trace(ref).value.nodes, fixed_eval);
        const setSitesWithKey = setFilter(setSites, site => {
            const siteKeyNode = site.arguments[0];
            const siteKeyValue = fixed_eval(siteKeyNode).value;
            return subsumes(siteKeyValue, key.value) || subsumes(key.value, siteKeyValue);
        })
        return setJoinMap(setSitesWithKey, site => {
            const valueArg = site.arguments[1];
            return fixed_eval(valueArg);
        });
    })
}
const mapSetPrimop = (() => botResult) as Primop
const objectFreezePrimop = ((_, __, ___, arg) => arg) as Primop
const arrayFromPrimop = ((_, __, ___, arg) => arg) as Primop
const questionQuestionPrimop = ((_, __, ___, lhs, rhs) => join(lhs, rhs)) as Primop
const barBarPrimop = ((_, __, ___, lhs, rhs) => join(lhs, rhs)) as Primop
export const primops = {
    'Math.floor': mathFloorPrimop,
    'String#includes': stringIncludesPrimop,
    'String#substring': stringSubstringPrimop,
    'String#split': stringSplitPrimop,
    'String#trim': stringTrimPrimop,
    'String#toLowerCase': stringToLowerCasePrimop,
    'fetch': fetchPrimop,
    'JSON.parse': jsonParsePrimop,
    'Date.now': dateNowPrimop,
    'String#match': stringMatchPrimop,
    'Array#map': arrayMapPrimop as Primop,
    'Array#filter': arrayFilterPrimop as Primop,
    'Array#indexOf': arrayIndexOf,
    'Array#some': arraySome,
    'Array#includes': arrayIncludes,
    'Array#find': arrayFindPrimop as Primop,
    'Map#keys': mapKeysPrimop as Primop,
    'Map#get': mapGetPrimop as Primop,
    'Map#set': mapSetPrimop,
    'Object.freeze': objectFreezePrimop,
    'Array.from': arrayFromPrimop,
    [SyntaxKind.QuestionQuestionToken as BinaryOperator]: questionQuestionPrimop,
    [SyntaxKind.BarBarToken as BinaryOperator]: barBarPrimop,
}

function createNullaryPrimopWithThis<R>(key: FlatLatticeKey, construct: (val: R, expression: PrimopExpression) => AbstractResult, f: () => R): Primop {
    return function(this: AbstractResult, expression) {
        return resultBind(this, key, thisItem =>
            construct(f.apply(thisItem, []), expression)
        );
    } 
}
function createUnaryPrimop<A, R>(key: FlatLatticeKey, construct: (val: R, expression: PrimopExpression) => AbstractResult, f: (item: A) => R): Primop {
    return (expression, _, _0, res) => 
        resultBind<A>(res, key, (item) => construct(f(item), expression));
}
function createUnaryPrimopWithThis<A, R>(key: FlatLatticeKey, construct: (val: R, expression: PrimopExpression) => AbstractResult, f: (item: A) => R): Primop {
    return function(this: AbstractResult, expression, _, _0, res) {
        return resultBind<A>(res, key, item => 
            resultBind(this, key, thisItem =>
                construct(f.apply(thisItem, [item]), expression)
            )
        );
    } 
}function createUnaryPrimopWithThisHetero<T, A, R>(thisKey: FlatLatticeKey, argKey: FlatLatticeKey, construct: (val: R, expression: PrimopExpression) => AbstractResult, f: (item: A) => R): Primop {
    return function(this: AbstractResult, expression, _, _0, res) {
        return resultBind<A>(res, argKey, item => 
            resultBind<T>(this, thisKey, thisItem =>
                construct(f.apply(thisItem, [item]), expression)
            )
        );
    } 
}
function createBinaryPrimop<A, R>(key: FlatLatticeKey, construct: (val: R, expression: PrimopExpression) => AbstractResult, f: (item1: A, item2: A) => R): Primop {
    return (expression, _, _0, res1, res2) =>
        resultBind2<A>(res1, res2, key, (item1, item2) =>
            construct(f(item1, item2), expression));
}
function createBinaryPrimopWithThisHetero<T, A, R>(thisKey: FlatLatticeKey, argsKey: FlatLatticeKey, construct: (val: R, expression: PrimopExpression) => AbstractResult, f: (item1: A, item2: A) => R): Primop {
    return function(this: AbstractResult, expression, _, _0, res1, res2) {
        return resultBind2<A>(res1, res2, argsKey, (item1, item2) => 
            resultBind<T>(this, thisKey, thisItem =>
                construct(f.apply(thisItem, [item1, item2]), expression)
            )
        );
    };
}

export const primopMath = objectResult(
    ts.factory.createObjectLiteralExpression(), // dummy
    {
        floor: primopValue('Math.floor'),
    }
)
export const primopFecth = primopResult('fetch');
export const primopJSON = objectResult(
    ts.factory.createObjectLiteralExpression(), // dummy
    {
        parse: primopValue('JSON.parse'),
    }
)
export const primopDate = objectResult(
    ts.factory.createObjectLiteralExpression(), // dummy
    {
        now: primopValue('Date.now')
    }
)
export const primopObject = objectResult(
    ts.factory.createObjectLiteralExpression(), // dummy
    {
        freeze: primopValue('Object.freeze')
    }
)
export const primopArray = objectResult(
    ts.factory.createObjectLiteralExpression(), // dummy
    {
        freeze: primopValue('Array.from')
    }
)

type PrimopInternalReferenceSites = {
    [id: string]: (args: ts.Expression[], argIndex: number) => SimpleSet<ts.Node>
}
export const primopInternalCallSites: PrimopInternalReferenceSites = {
    'Array#map': arrayMapInternalReferenceSites
}

function arrayMapInternalReferenceSites(this: ts.Expression, args: ts.Expression[], argIndex: number): SimpleSet<ts.Node> {
    if (argIndex !== 0) {
        return empty();
    }
    
    const convert = args[0]; // convert
    const arrayAccess = ts.factory.createElementAccessExpression(this, 0); // this[0]
    const call = ts.factory.createCallExpression(convert, [], [arrayAccess]); // convert(this[0])
    const clonedCall = cloneNode(call, { setParents: true });
    return singleton<ts.Node>(clonedCall.expression);
}

function getMapSetCalls(returnSites: SimpleSet<ts.Node>, fixed_eval: FixedEval): SimpleSet<ts.CallExpression> {
    const callSitesOrFalses = setMap(returnSites, site => {
        const access = site.parent;
        if (!(ts.isPropertyAccessExpression(access))) {
            return false;
        }
        const accessResult = fixed_eval(access);
        if (!subsumes(accessResult.value, primopValue('Map#set'))) {
            return false;
        }

        const call = access.parent;
        if (!ts.isCallExpression(call)) {
            return false;
        }

        return call;
    });
    return setSift(callSitesOrFalses);
}
