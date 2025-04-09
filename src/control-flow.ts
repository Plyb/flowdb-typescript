import ts from 'typescript';
import { isTop, joinAllValues, NodeLattice, NodeLatticeElem, nodeLatticeFilter } from './abstract-values';
import { FixedEval } from './dcfa';
import { FixRunFunc, makeFixpointComputer } from './fixpoint';
import { empty, setFlatMap, setMap, singleton, union } from './setUtil';
import { findAll, findAllCalls, isFunctionLikeDeclaration, SimpleFunctionLikeDeclaration } from './ts-utils';

export function getReachableFunctions(node: SimpleFunctionLikeDeclaration, fixed_eval: FixedEval): NodeLattice {
    const valueOf = makeFixpointComputer(empty<NodeLatticeElem>(), { printArgs: getFuncName, printRet: set => setMap(set, getFuncName).toString() });
    return valueOf({ func: compute, args: node }, );
    
    function compute(node: NodeLatticeElem, fix_run: FixRunFunc<NodeLatticeElem, NodeLattice>): NodeLattice {
        const directlyCalledFunctions = findAllFunctionsCalledInBody(node, fixed_eval);
        const functionsCalledInDirectlyCalledFunctions = setFlatMap(
            directlyCalledFunctions,
            (func) => fix_run(compute, func)
        )
        return union(singleton<NodeLatticeElem>(node), functionsCalledInDirectlyCalledFunctions);
    }
    
    function getFuncName(func: NodeLatticeElem) {
        if (isTop(func)) {
            return 'ANY FUNCTION';
        }

        const { line, character } = ts.getLineAndCharacterOfPosition(func.getSourceFile(), func.pos)
        if (ts.isFunctionDeclaration(func)) {
            return func.name?.text ?? `<anonymous:${line}:${character}>`
        }
        return `<anonymous:${line}:${character}>`;
    }
}

function findAllFunctionsCalledInBody(node: NodeLatticeElem, fixed_eval: FixedEval): NodeLattice {
    if (isTop(node)) {
        return empty();
    }

    const callExpressions = [...findAllCalls((node as SimpleFunctionLikeDeclaration).body)];
    const valuesOfCallExpressionOperators = callExpressions.map(callExpression =>
        fixed_eval(callExpression.expression)
    );
    return nodeLatticeFilter(joinAllValues(...valuesOfCallExpressionOperators), isFunctionLikeDeclaration);
}