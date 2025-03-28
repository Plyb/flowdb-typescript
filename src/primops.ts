import ts from 'typescript';
import { AbstractValue, getElementNodesOfArrayValuedNode, NodeLattice, NodeLatticeElem, nodeLatticeMap, nodeLatticeSome } from './abstract-values';
import { empty, setSift } from './setUtil';
import { getBuiltInValueOfBuiltInConstructor, isBuiltInConstructorShaped } from './value-constructors';
import { NodePrinter } from './ts-utils';
import { FixedEval } from './dcfa';

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
