import ts, { CallExpression } from 'typescript';
import { AbstractResult, botResult, join, nodeLatticeJoinMap, nodeLatticeSome, result, resultBind, resultBind2, resultFrom, setJoinMap, topResult } from './abstract-results';
import { anyBooleanValue, anyDateValue, anyNumberValue, booleanValue, FlatLatticeKey, MapRef, NodeLattice, NodeLatticeElem, nodeLatticeMap, numberValue, stringValue, subsumes } from './abstract-values';
import { empty, setFilter, setSift } from './setUtil';
import { getElementNodesOfArrayValuedNode } from './util';
import { getBuiltInValueOfBuiltInConstructor, isBuiltInConstructorShaped, NodePrinter } from './value-constructors';

export type FixedEval = (node: ts.Node) => AbstractResult;
export type FixedTrace = (node: ts.Node) => AbstractResult;
export type PrimopApplication = ts.CallExpression | ts.BinaryExpression;
type Primop = (expression: PrimopApplication, fixed_eval: FixedEval, fixed_trace: FixedTrace, ...args: AbstractResult[]) => AbstractResult

const mathFloorPrimop = createUnaryPrimop('numbers', resultFrom(numberValue), Math.floor);
const stringIncludesPrimop =
    createUnaryPrimopWithThis('strings', resultFrom(booleanValue), String.prototype.includes);
const stringSubstringPrimop =
    createBinaryPrimopWithThisHetero('strings', 'numbers', resultFrom(stringValue),
        String.prototype.substring
    );
const stringTrimPrimop =
    createNullaryPrimopWithThis('strings', resultFrom(stringValue), String.prototype.trim);
const stringToLowerCasePrimop =
    createNullaryPrimopWithThis('strings', resultFrom(stringValue), String.prototype.toLowerCase);
const jsonParsePrimop = createUnaryPrimop('strings', () => topResult, () => null);
const dateNowPrimop = (() => result(anyDateValue)) as Primop;
const arrayIndexOf = (() => result(anyNumberValue)) as Primop;
const arraySome = (() => result(anyBooleanValue)) as Primop;
function mapKeysPrimop(this: AbstractResult, _: PrimopApplication, fixed_eval: FixedEval, fixed_trace: FixedTrace): AbstractResult {
    return resultBind<MapRef>(this, 'maps', (ref) => {
        const setSites = getMapSetCalls(fixed_trace(ref).value.nodes, null as any);
        return nodeLatticeJoinMap(setSites, site => {
            const keyArg = (site as CallExpression).arguments[0];
            return fixed_eval(keyArg)
        });
    })
}
function mapGetPrimop(this: AbstractResult, _: PrimopApplication, fixed_eval: FixedEval, fixed_trace: FixedTrace, key: AbstractResult): AbstractResult {
    return resultBind<MapRef>(this, 'maps', (ref) => {
        const setSites = getMapSetCalls(fixed_trace(ref).value.nodes, null as any);
        const setSitesWithKey = setFilter(setSites, site => {
            const siteKeyNode = (site as CallExpression).arguments[0];
            const siteKeyValue = fixed_eval(siteKeyNode).value;
            return subsumes(siteKeyValue, key.value) || subsumes(key.value, siteKeyValue);
        })
        return setJoinMap(setSitesWithKey, site => {
            const valueArg = (site as CallExpression).arguments[1];
            return fixed_eval(valueArg);
        });
    })
}
const mapSetPrimop = (() => botResult) as Primop
const objectFreezePrimop = ((_, __, ___, arg) => arg) as Primop
const arrayFromPrimop = ((_, __, ___, arg) => arg) as Primop
const questionQuestionPrimop = ((_, __, ___, lhs, rhs) => join(lhs, rhs)) as Primop
const barBarPrimop = ((_, __, ___, lhs, rhs) => join(lhs, rhs)) as Primop
const regexTestPrimop = createUnaryPrimopWithThisHetero('regexps', 'strings', resultFrom(booleanValue), RegExp.prototype.test);

function createNullaryPrimopWithThis<R>(key: FlatLatticeKey, construct: (val: R, expression: PrimopApplication) => AbstractResult, f: () => R): Primop {
    return function(this: AbstractResult, expression) {
        return resultBind(this, key, thisItem =>
            construct(f.apply(thisItem, []), expression)
        );
    } 
}
function createUnaryPrimop<A, R>(key: FlatLatticeKey, construct: (val: R, expression: PrimopApplication) => AbstractResult, f: (item: A) => R): Primop {
    return (expression, _, _0, res) => 
        resultBind<A>(res, key, (item) => construct(f(item), expression));
}
function createUnaryPrimopWithThis<A, R>(key: FlatLatticeKey, construct: (val: R, expression: PrimopApplication) => AbstractResult, f: (item: A) => R): Primop {
    return function(this: AbstractResult, expression, _, _0, res) {
        return resultBind<A>(res, key, item => 
            resultBind(this, key, thisItem =>
                construct(f.apply(thisItem, [item]), expression)
            )
        );
    } 
}function createUnaryPrimopWithThisHetero<T, A, R>(thisKey: FlatLatticeKey, argKey: FlatLatticeKey, construct: (val: R, expression: PrimopApplication) => AbstractResult, f: (item: A) => R): Primop {
    return function(this: AbstractResult, expression, _, _0, res) {
        return resultBind<A>(res, argKey, item => 
            resultBind<T>(this, thisKey, thisItem =>
                construct(f.apply(thisItem, [item]), expression)
            )
        );
    } 
}
function createBinaryPrimop<A, R>(key: FlatLatticeKey, construct: (val: R, expression: PrimopApplication) => AbstractResult, f: (item1: A, item2: A) => R): Primop {
    return (expression, _, _0, res1, res2) =>
        resultBind2<A>(res1, res2, key, (item1, item2) =>
            construct(f(item1, item2), expression));
}
function createBinaryPrimopWithThisHetero<T, A, R>(thisKey: FlatLatticeKey, argsKey: FlatLatticeKey, construct: (val: R, expression: PrimopApplication) => AbstractResult, f: (item1: A, item2: A) => R): Primop {
    return function(this: AbstractResult, expression, _, _0, res1, res2) {
        return resultBind2<A>(res1, res2, argsKey, (item1, item2) => 
            resultBind<T>(this, thisKey, thisItem =>
                construct(f.apply(thisItem, [item1, item2]), expression)
            )
        );
    };
}

// export const primopMath = objectResult(
//     ts.factory.createObjectLiteralExpression(), // dummy
//     {
//         floor: primopValue('Math.floor'),
//     }
// )
// export const primopFecth = primopResult('fetch');
// export const primopJSON = objectResult(
//     ts.factory.createObjectLiteralExpression(), // dummy
//     {
//         parse: primopValue('JSON.parse'),
//     }
// )
// export const primopDate = objectResult(
//     ts.factory.createObjectLiteralExpression(), // dummy
//     {
//         now: primopValue('Date.now')
//     }
// )
// export const primopObject = objectResult(
//     ts.factory.createObjectLiteralExpression(), // dummy
//     {
//         freeze: primopValue('Object.freeze')
//     }
// )
// export const primopArray = objectResult(
//     ts.factory.createObjectLiteralExpression(), // dummy
//     {
//         from: primopValue('Array.from')
//     }
// )

export function getMapSetCalls(returnSites: NodeLattice, { fixed_eval, printNodeAndPos }: { fixed_eval: FixedEval, printNodeAndPos: NodePrinter }): NodeLattice {
    const callSitesOrFalses = nodeLatticeMap(returnSites, site => {
        const access = site.parent;
        if (!(ts.isPropertyAccessExpression(access))) {
            return false;
        }
        const accessResult = fixed_eval(access);
        if (!nodeLatticeSome(accessResult.value.nodes, cons =>
                isBuiltInConstructorShaped(cons)
                && getBuiltInValueOfBuiltInConstructor(cons, fixed_eval, printNodeAndPos) === 'Map#set'
            )
        ) {
            return false;
        }

        const call = access.parent;
        if (!ts.isCallExpression(call)) {
            return false;
        }

        return call as ts.Node;
    });
    return setSift(callSitesOrFalses);
}

type PrimopFunctionArgParamBinderGetter = (this: ts.Expression | undefined, primopArgIndex: number, argParameterIndex: number, args: { fixed_eval: FixedEval, fixed_trace: FixedTrace, printNodeAndPos: NodePrinter }) => NodeLattice;

type PrimopBinderGetters = {
    [id: string]: PrimopFunctionArgParamBinderGetter
}

export const primopBinderGetters: PrimopBinderGetters = { // TODO: fill this out and make it type safe
    'Array#map': arrayMapArgBinderGetter
}

function arrayMapArgBinderGetter(this: ts.Expression | undefined, primopArgIndex: number, argParameterIndex: number, { fixed_eval, fixed_trace, printNodeAndPos }: { fixed_eval: FixedEval, fixed_trace: FixedTrace, printNodeAndPos: NodePrinter }) {
    if (this === undefined) {
        throw new Error();
    }
    
    if (primopArgIndex != 0 || argParameterIndex != 0) {
        return empty<NodeLatticeElem>();
    }
    return getElementNodesOfArrayValuedNode(this, { fixed_eval, fixed_trace, printNodeAndPos });
}
