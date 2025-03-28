import ts from 'typescript';
import { AbstractValue, getElementNodesOfArrayValuedNode, NodeLattice, NodeLatticeElem, nodeLatticeMap, nodeLatticeSome } from './abstract-values';
import { empty, setSift } from './setUtil';
import { getBuiltInValueOfBuiltInConstructor, isBuiltInConstructorShaped, NodePrinter } from './value-constructors';

export type FixedEval = (node: ts.Node) => AbstractValue;
export type FixedTrace = (node: ts.Node) => AbstractValue;
export type PrimopApplication = ts.CallExpression | ts.BinaryExpression;

export function getMapSetCalls(returnSites: NodeLattice, { fixed_eval, printNodeAndPos }: { fixed_eval: FixedEval, printNodeAndPos: NodePrinter }): NodeLattice {
    const callSitesOrFalses = nodeLatticeMap(returnSites, site => {
        const access = site.parent;
        if (!(ts.isPropertyAccessExpression(access))) {
            return false;
        }
        const accessConses = fixed_eval(access);
        if (!nodeLatticeSome(accessConses, cons =>
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
