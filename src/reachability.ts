import { SimpleSet } from 'typescript-super-set';
import { Config, printConfig } from './configuration';
import { FixRunFunc, makeFixpointComputer } from './fixpoint';
import { empty, setFlatMap, setMap } from './setUtil';
import { StructuralSet } from './structural-set';
import { structuralComparator } from './comparators';
import { isExtern } from './abstract-values';

type Query = {
    method: QueryMethod,
    config: Config
}
type QueryMethod = 'abstractEval' | 'getWhereValueApplied' | 'getWhereClosed';

export function getReachableQueries(topLevelQuery: Query): StructuralSet<Query> {
    const valueOf = makeFixpointComputer(empty<Query>(), { printArgs: printQuery, printRet: set => setMap(set, printQuery).toString() });
    return valueOf({ func: compute, args: topLevelQuery });

    function compute(q: Query, fix_run: FixRunFunc<Query, StructuralSet<Query>>): StructuralSet<Query> {
        const directlyReachableQueries = getDirectlyReachableQueriesSet(q);
        const transitivelyReachableQueries = setFlatMap(
            directlyReachableQueries,
            q => fix_run(compute, q)
        );
        return transitivelyReachableQueries;
    }
}

function getDirectlyReachableQueriesSet(q: Query): StructuralSet<Query> {
    return new SimpleSet(structuralComparator, ...getDirectlyReachableQueries(q));
}

function* getDirectlyReachableQueries(q: Query): Iterable<Query> {
    yield q;
    if (isExtern(q.config.node)) {
        return;
    }

    // TODO mcfa
}

function printQuery(q: Query) {
    return `${q.method}(${printConfig(q.config)})`;
}