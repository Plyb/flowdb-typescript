import ts from 'typescript';
import { isTop, joinAllValues, NodeLattice, NodeLatticeElem, nodeLatticeFilter } from './abstract-values';
import { FixedEval } from './dcfa';
import { FixRunFunc, makeFixpointComputer } from './fixpoint';
import { empty, setFilter, setFlatMap, setMap, singleton, union } from './setUtil';
import { findAllCalls, isFunctionLikeDeclaration, printNodeAndPos, SimpleFunctionLikeDeclaration } from './ts-utils';
import { SimpleSet } from 'typescript-super-set';

export function getReachableFunctions(node: ts.Block | ts.Expression, fixed_eval: FixedEval): SimpleSet<SimpleFunctionLikeDeclaration> {
    const valueOf = makeFixpointComputer(empty<SimpleFunctionLikeDeclaration>(), { printArgs: printNodeAndPos as (node: ts.Block | ts.Expression) => string, printRet: set => setMap(set, getFuncName).toString() });
    return valueOf({ func: compute, args: node });
    
    function compute(node: ts.Block | ts.Expression, fix_run: FixRunFunc<ts.Block | ts.Expression, SimpleSet<SimpleFunctionLikeDeclaration>>): SimpleSet<SimpleFunctionLikeDeclaration> {
        const directlyCalledFunctions = findAllFunctionsCalledIn(node, fixed_eval);
        const functionsCalledInDirectlyCalledFunctions = setFlatMap(
            directlyCalledFunctions,
            (func) => union(singleton(func), fix_run(compute, func.body))
        )
        return functionsCalledInDirectlyCalledFunctions;
    }
    
    function getFuncName(func: SimpleFunctionLikeDeclaration) {
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

function findAllFunctionsCalledIn(node: ts.Block | ts.Expression, fixed_eval: FixedEval): SimpleSet<SimpleFunctionLikeDeclaration> {
    const callExpressions = [...findAllCalls(node)];
    const valuesOfCallExpressionOperators = callExpressions.map(callExpression =>
        fixed_eval(callExpression.expression)
    );
    return setFilter(joinAllValues(...valuesOfCallExpressionOperators), isFunctionLikeDeclaration);
}

export function getReachableBlocks(block: ts.Block, fixed_eval: FixedEval): SimpleSet<ts.Block> {
    const reachableFuncs = getReachableFunctions(block, fixed_eval);
    const bodies = setMap(reachableFuncs, func => func.body);
    return union(singleton(block), setFilter(bodies, ts.isBlock));
}