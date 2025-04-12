import ts from 'typescript';
import { findAllPrismaQueryExpressions, getNodeAtPosition, getPrismaQuery, isFunctionLikeDeclaration, isPrismaQuery, printNodeAndPos, SimpleFunctionLikeDeclaration } from './ts-utils';
import { makeDcfaComputer } from './dcfa';
import { setFilter, setFlatMap, setMap, setSift, singleton, union } from './setUtil';
import { isExtern } from './abstract-values';
import { getReachableCallConfigs } from './control-flow';
import { isConfigNoExtern, withUnknownContext } from './configuration';

export function analyze(service: ts.LanguageService, filePath: string, line: number, col: number, m: number) {
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
        throw new Error(`expected function declaration $${printNodeAndPos(node)}`);
    }

    const fixed_eval = makeDcfaComputer(service, node, m);

    const reachableCallConfigsWithExterns = getReachableCallConfigs(withUnknownContext(node.body), m, fixed_eval)
    const reachableCallConfigs = setFilter(reachableCallConfigsWithExterns, elem => isConfigNoExtern(elem));
    const prismaQueryExpressionsConfigs = setSift(setMap(reachableCallConfigs, callConfig => {
        const qExp = getPrismaQuery(callConfig.node);
        if (qExp === false) {
            return undefined;
        }
        return {
            qExp,
            env: callConfig.env
        }
    }));
    return setMap(prismaQueryExpressionsConfigs, ({ qExp, env }) => ({
        table: qExp.table,
        method: qExp.method,
        argument: fixed_eval({ node: qExp.argument, env })
    }))
}
