import ts from 'typescript';
import { findAll, findAllPrismaQueryExpressions, getNodeAtPosition, isFunctionLikeDeclaration, SimpleFunctionLikeDeclaration } from './ts-utils';
import { FixRunFunc, makeFixpointComputer } from './fixpoint';
import { makeDcfaComputer } from './dcfa';
import { empty, setFilter, setFlatMap, setMap, singleton, union } from './setUtil';
import { AbstractValue, isTop, joinAllValues, NodeLattice, NodeLatticeElem, nodeLatticeFilter } from './abstract-values';

export function analyze(service: ts.LanguageService, filePath: string, line: number, col: number) {
    const program = service.getProgram()!;
    
    const sf = program.getSourceFiles().find(sf => sf.fileName === filePath);
    if (sf === undefined) {
        throw new Error(`Unknown file name: ${filePath}`)
    }
    const pos = sf.getPositionOfLineAndCharacter(line, col);
    const node = getNodeAtPosition(sf, pos);
    if (node === undefined) {
        throw new Error('no node at that position')
    }
    if (!isFunctionLikeDeclaration(node)) {
        throw new Error('expected function declaration');
    }

    const dcfa = makeDcfaComputer(service, node);

    const reachableFunctionsWithTops = getReachableFunctions(node, dcfa);
    const reachableFunctions = setFilter(reachableFunctionsWithTops, elem => !isTop(elem));
    const prismaQueryExpressions = setFlatMap(reachableFunctions, func => findAllPrismaQueryExpressions((func as SimpleFunctionLikeDeclaration).body));
    return setMap(prismaQueryExpressions, qExp => ({
        table: qExp.table,
        method: qExp.method,
        argument: dcfa(qExp.argument)
    }))
}



function getReachableFunctions(node: SimpleFunctionLikeDeclaration, dcfa: (node: ts.Node) => AbstractValue): NodeLattice {
    const valueOf = makeFixpointComputer(empty<NodeLatticeElem>(), { printArgs: getFuncName, printRet: set => setMap(set, getFuncName).toString() });
    return valueOf({ func: compute, args: node }, );
    
    function compute(node: NodeLatticeElem, fix_run: FixRunFunc<NodeLatticeElem, NodeLattice>): NodeLattice {
        const directlyCalledFunctions = findAllFunctionsCalledInBody(node, dcfa);
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

function findAllFunctionsCalledInBody(node: NodeLatticeElem, dcfa: (node: ts.Node) => AbstractValue): NodeLattice {
    if (isTop(node)) {
        return empty();
    }

    const callExpressions = [...findAllCalls((node as SimpleFunctionLikeDeclaration).body)];
    const valuesOfCallExpressionOperators = callExpressions.map(callExpression =>
        dcfa(callExpression.expression)
    );
    return nodeLatticeFilter(joinAllValues(...valuesOfCallExpressionOperators), isFunctionLikeDeclaration);
}

function findAllCalls(node: ts.Node): Iterable<ts.CallExpression> {
    return findAll(node, ts.isCallExpression) as Iterable<ts.CallExpression>;
}
