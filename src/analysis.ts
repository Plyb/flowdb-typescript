import ts, { Identifier } from 'typescript';
import { findAll, findAllPrismaQueryExpressions, getNodeAtPosition, isFunctionLikeDeclaration, SimpleFunctionLikeDeclaration } from './ts-utils';
import { FixRunFunc, valueOf } from './fixpoint';
import { dcfa } from './dcfa';
import { joinAll } from './abstract-results';
import { SimpleSet } from 'typescript-super-set';
import { empty, setFlatMap, setMap, singleton, union } from './setUtil';
import { structuralComparator } from './comparators';

export function analyze(service: ts.LanguageService, line: number, col: number) {
    const program = service.getProgram()!;
    
    const sf = program.getSourceFiles()[0];
    const pos = sf.getPositionOfLineAndCharacter(line, col);
    const node = getNodeAtPosition(sf, pos);
    if (node === undefined) {
        throw new Error('no node at that position')
    }
    if (!isFunctionLikeDeclaration(node)) {
        throw new Error('expected function declaration');
    }

    const reachableFunctions = getReachableFunctions(node, service);
    const prismaQueryExpressions = setFlatMap(reachableFunctions, func => findAllPrismaQueryExpressions(func.body));
    return setMap(prismaQueryExpressions, qExp => ({
        table: qExp.table,
        method: qExp.method,
        argument: dcfa(qExp.argument, service)
    }))
}



function getReachableFunctions(node: SimpleFunctionLikeDeclaration, service: ts.LanguageService): SimpleSet<SimpleFunctionLikeDeclaration> {
    const sf = service.getProgram()?.getSourceFiles()[0]!;
    return valueOf({ func: compute, args: node }, empty(), getFuncName, set => setMap(set, getFuncName).toString());
    
    function compute(node: SimpleFunctionLikeDeclaration, fix_run: FixRunFunc<SimpleFunctionLikeDeclaration, SimpleSet<SimpleFunctionLikeDeclaration>>): SimpleSet<SimpleFunctionLikeDeclaration> {
        const directlyCalledFunctions = findAllFunctionsCalledInBody(node, service);
        const functionsCalledInDirectlyCalledFunctions = setFlatMap(
            directlyCalledFunctions,
            (func) => fix_run(compute, func)
        )
        return union(directlyCalledFunctions, functionsCalledInDirectlyCalledFunctions);
    }
    
    function getFuncName(func: SimpleFunctionLikeDeclaration) {
        const { line, character } = ts.getLineAndCharacterOfPosition(sf, func.pos)
        if (ts.isFunctionDeclaration(func)) {
            return func.name?.text ?? `<anonymous:${line}:${character}>`
        }
        return `<anonymous:${line}:${character}>`;
    }
}

function findAllFunctionsCalledInBody(node: SimpleFunctionLikeDeclaration, service: ts.LanguageService): SimpleSet<SimpleFunctionLikeDeclaration> {
    const callExpressions = [...findAllCalls(node.body)];
    const valuesOfCallExpressionOperators = callExpressions.map(callExpression =>
        dcfa(callExpression.expression, service)
    );
    return joinAll(...valuesOfCallExpressionOperators).value.nodes as any as SimpleSet<SimpleFunctionLikeDeclaration>;
}

function findAllCalls(node: ts.Node): Iterable<ts.CallExpression> {
    return findAll(node, ts.isCallExpression) as Iterable<ts.CallExpression>;
}
