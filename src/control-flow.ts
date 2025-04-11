import ts, { ConciseBody } from 'typescript';
import { configSetJoinMap, configValue, isExtern, joinAllValues } from './abstract-values';
import { FixedEval } from './dcfa';
import { FixRunFunc, makeFixpointComputer } from './fixpoint';
import { empty, setFilter, setFlatMap, setMap, singleton, union } from './setUtil';
import { findAllCalls, isFunctionLikeDeclaration, printNodeAndPos, SimpleFunctionLikeDeclaration } from './ts-utils';
import { StructuralSet } from './structural-set';
import { Config, ConfigNoExtern, configSetFilter, configSetMap, isBlockConfig, isConfigExtern, isConfigNoExtern, isFunctionLikeDeclarationConfig, printConfig, pushContext } from './configuration';
import { SimpleSet } from 'typescript-super-set';
import { structuralComparator } from './comparators';
import { consList } from './util';

export function getReachableCallConfigs(config: Config<ConciseBody>, m: number, fixed_eval: FixedEval): StructuralSet<Config<ts.CallExpression>> {
    const valueOf = makeFixpointComputer(
        empty<Config<ts.CallExpression>>(),
        { printArgs: printConfig as (config: Config<ConciseBody>) => string, printRet: set => setMap(set, printConfig).toString()}
    );
    return valueOf({ func: compute, args: config })

    function compute(config: Config<ConciseBody>, fix_run: FixRunFunc<Config<ConciseBody>, StructuralSet<Config<ts.CallExpression>>>): StructuralSet<Config<ts.CallExpression>> {
        const directCallSites = new SimpleSet(structuralComparator, ...findAllCalls(config.node));
        const directCallSiteConfigs = setMap(directCallSites, site => ({ node: site, env: config.env}) as Config<ts.CallExpression>)
        const transitiveCallSiteConfigs = configSetJoinMap(
            directCallSiteConfigs,
            ({ node: site, env }) => {
                const operators = fixed_eval({ node: site.expression, env });
                return configSetJoinMap(operators, ({ node: op, env: funcEnv }) => {
                    if (!isFunctionLikeDeclaration(op)) {
                        return empty(); // built in functions fit this criterion
                    }
                    return fix_run(compute, {
                        node: op.body,
                        env: consList(pushContext(site, env, m), funcEnv)
                    })
                });
            }
        ) as StructuralSet<Config<ts.CallExpression>>;
        return union(directCallSiteConfigs, transitiveCallSiteConfigs);
    }
}

export function getReachableBlocks(blockConfig: Config<ts.Block>, m: number, fixed_eval: FixedEval): StructuralSet<Config<ts.Block>> {
    const reachableCalls = getReachableCallConfigs(blockConfig, m, fixed_eval);
    const otherReachableBodies = configSetJoinMap(reachableCalls, callConfig => {
        const operatorConfig = { node: callConfig.node.expression, env: callConfig.env };
        const possibleFunctions = fixed_eval(operatorConfig);
        return setFlatMap(possibleFunctions, funcConfig => {
            if (!isFunctionLikeDeclarationConfig(funcConfig)) {
                return empty();
            }
            return configValue({
                node: funcConfig.node.body,
                env: consList(pushContext(callConfig.node, callConfig.env, m), funcConfig.env),
            })
        })
    }) as StructuralSet<ConfigNoExtern>;
    return union(singleton(blockConfig), setFilter(otherReachableBodies, isBlockConfig));
}