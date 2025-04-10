import ts from 'typescript';
import { findAllPrismaQueryExpressions, getNodeAtPosition, isFunctionLikeDeclaration, SimpleFunctionLikeDeclaration } from './ts-utils';
import { makeDcfaComputer } from './dcfa';
import { setFilter, setFlatMap, setMap, singleton, union } from './setUtil';
import { isExtern } from './abstract-values';
import { getReachableFunctions } from './control-flow';
import { withZeroContext } from './configuration';

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

    const fixed_eval = makeDcfaComputer(service, node);

    const reachableFunctionsWithExterns = union(singleton(node), getReachableFunctions(node.body, fixed_eval));
    const reachableFunctions = setFilter(reachableFunctionsWithExterns, elem => !isExtern(elem));
    const prismaQueryExpressions = setFlatMap(reachableFunctions, func => findAllPrismaQueryExpressions((func as SimpleFunctionLikeDeclaration).body));
    return setMap(prismaQueryExpressions, qExp => ({
        table: qExp.table,
        method: qExp.method,
        argument: fixed_eval(withZeroContext(qExp.argument)) // TODO mcfa
    }))
}
