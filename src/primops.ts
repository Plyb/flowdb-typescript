import ts, { CallExpression } from 'typescript';
import { AbstractResult, anyObjectResult, arrayResult, botResult, objectResult, primopResult, promiseResult, result, resultBind, resultBind2, resultFrom, setJoinMap, topResult } from './abstract-results';
import { AbstractValue, anyBooleanValue, anyDateValue, anyNumberValue, ArrayRef, booleanValue, botValue, LatticeKey, MapRef, numberValue, primopValue, stringValue, subsumes, top } from './abstract-values';
import { structuralComparator } from './comparators';
import { SimpleSet } from 'typescript-super-set';
import { empty, setFilter, setMap, setSift, singleton } from './setUtil';
import { FixRunFunc } from './fixpoint';
import { SimpleFunctionLikeDeclaration } from './ts-utils';
import { id } from './util';

export type PrimopId = keyof Primops;
type Primops = typeof primops
export type FixedEval = (node: ts.Node) => AbstractResult;
export type FixedTrace = (node: ts.Node) => AbstractResult;
type Primop = (callExpression: ts.CallExpression, fixed_eval: FixedEval, fixed_trace: FixedTrace, ...args: AbstractResult[]) => AbstractResult

const mathFloorPrimop = createUnaryPrimop('numbers', resultFrom(numberValue), Math.floor);
const stringIncludesPrimop =
    createUnaryPrimopWithThis('strings', resultFrom(booleanValue), String.prototype.includes);
const stringSubstringPrimop =
    createBinaryPrimopWithThisHetero('strings', 'numbers', resultFrom(stringValue),
        String.prototype.substring
    );
const stringSplitPrimop =
    createUnaryPrimopWithThis('strings',
        (arr, callExpression) =>
            arrayResult(
                callExpression,
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
        (_, callExpression) =>
            promiseResult(callExpression, anyObjectResult),
        () => null
    );
const jsonParsePrimop = createUnaryPrimop('strings', () => topResult, () => null);
const dateNowPrimop = (() => result(anyDateValue)) as Primop;
const stringMatchPrimop = createUnaryPrimopWithThisHetero('strings', 'regexps',
    (arr, callExpression) =>
        arrayResult(
            callExpression,
            setJoinMap(new SimpleSet(structuralComparator, ...arr!), resultFrom(stringValue))
        ),
    String.prototype.match
)
function arrayMapPrimop(callExpression: ts.CallExpression, fixed_eval: FixedEval, _: FixedTrace, arg: AbstractResult): AbstractResult {
    const elementResult = setJoinMap(arg.value.nodes, func => fixed_eval((func as SimpleFunctionLikeDeclaration).body));
    return arrayResult(callExpression, elementResult);
}
function arrayFilterPrimop(this: AbstractResult, callExpression: ts.CallExpression): AbstractResult {
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
    return arrayResult(callExpression, elementResult);
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
function mapKeysPrimop(this: AbstractResult, _: CallExpression, fixed_eval: FixedEval, fixed_trace: FixedTrace): AbstractResult {
    return resultBind<MapRef>(this, 'maps', (ref) => {
        const setSites = getMapSetCalls(fixed_trace(ref).value.nodes, fixed_eval);
        return setJoinMap(setSites, site => {
            const keyArg = site.arguments[0];
            return fixed_eval(keyArg)
        });
    })
}
function mapGetPrimop(this: AbstractResult, _: CallExpression, fixed_eval: FixedEval, fixed_trace: FixedTrace, key: AbstractResult): AbstractResult {
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
}

function createNullaryPrimopWithThis<R>(key: LatticeKey, construct: (val: R, callExpression: ts.CallExpression) => AbstractResult, f: () => R): Primop {
    return function(this: AbstractResult, callExpression) {
        return resultBind(this, key, thisItem =>
            construct(f.apply(thisItem, []), callExpression)
        );
    } 
}
function createUnaryPrimop<A, R>(key: LatticeKey, construct: (val: R, callExpression: ts.CallExpression) => AbstractResult, f: (item: A) => R): Primop {
    return (callExpression, _, _0, res) => 
        resultBind<A>(res, key, (item) => construct(f(item), callExpression));
}
function createUnaryPrimopWithThis<A, R>(key: LatticeKey, construct: (val: R, callExpression: ts.CallExpression) => AbstractResult, f: (item: A) => R): Primop {
    return function(this: AbstractResult, callExpression, _, _0, res) {
        return resultBind<A>(res, key, item => 
            resultBind(this, key, thisItem =>
                construct(f.apply(thisItem, [item]), callExpression)
            )
        );
    } 
}function createUnaryPrimopWithThisHetero<T, A, R>(thisKey: LatticeKey, argKey: LatticeKey, construct: (val: R, callExpression: ts.CallExpression) => AbstractResult, f: (item: A) => R): Primop {
    return function(this: AbstractResult, callExpression, _, _0, res) {
        return resultBind<A>(res, argKey, item => 
            resultBind<T>(this, thisKey, thisItem =>
                construct(f.apply(thisItem, [item]), callExpression)
            )
        );
    } 
}
function createBinaryPrimop<A, R>(key: LatticeKey, construct: (val: R, callExpression: ts.CallExpression) => AbstractResult, f: (item1: A, item2: A) => R): Primop {
    return (callExpression, _, _0, res1, res2) =>
        resultBind2<A>(res1, res2, key, (item1, item2) =>
            construct(f(item1, item2), callExpression));
}
function createBinaryPrimopWithThisHetero<T, A, R>(thisKey: LatticeKey, argsKey: LatticeKey, construct: (val: R, callExpression: ts.CallExpression) => AbstractResult, f: (item1: A, item2: A) => R): Primop {
    return function(this: AbstractResult, callExpression, _, _0, res1, res2) {
        return resultBind2<A>(res1, res2, argsKey, (item1, item2) => 
            resultBind<T>(this, thisKey, thisItem =>
                construct(f.apply(thisItem, [item1, item2]), callExpression)
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

type PrimopInternalCallSites = {
    [id: string]: (args: ts.Expression[], argIndex: number) => SimpleSet<ts.Node>
}
export const primopInternalCallSites: PrimopInternalCallSites = {
    'Array#map': arrayMapInternalCallSites
}

function arrayMapInternalCallSites(this: ts.Expression, args: ts.Expression[], argIndex: number): SimpleSet<ts.Node> {
    if (argIndex !== 0) {
        return empty();
    }
    
    const convert = args[0];
    const arrayAccess = ts.factory.createElementAccessExpression(this, 0);
    return singleton<ts.Node>(ts.factory.createCallExpression(convert, [], [arrayAccess]));
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
