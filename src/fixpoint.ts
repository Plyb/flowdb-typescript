import { ComparatorResult, SimpleSet } from 'typescript-super-set'
import { Lookup } from './lookup'
import { SimpleMap } from './simple-map'
import { RecordOf, Map, Set, Record } from 'immutable'
import Immutable from 'immutable'

type Fixable<Args, Ret> = (args: Args, fix_run: FixRunFunc<Args, Ret>, push_cache: CachePusher<Args, Ret>) => Ret
export type LabeledFixable<Args, Ret> = Fixable<Args, Ret> & { name: string}
export type FixRunFunc<Args, Ret> = (func: LabeledFixable<Args, Ret>, args: Args) => Ret
export type CachePusher<Args, Ret> = (comp: Computation<Args, Ret>, val: Ret) => void
export type Computation<Args, Ret> = RecordOf<{ func: LabeledFixable<Args, Ret>, args: Args }>

const ComputationRecord = Record({
    func: null as any,
    args: null as any,
});
export function Computation<Args, Ret>(comp: { func: LabeledFixable<Args, Ret>, args: Args }) {
    return ComputationRecord(comp) as Computation<Args, Ret>
}

type ValueMap<Args, Ret> = Map<Computation<Args, Ret>, Ret>
type DependentMap<Args, Ret> = Lookup<Computation<Args, Ret>, Computation<Args, Ret>>
type ValueOfOptions<Args, Ret> = {
    printArgs: (arg: Args) => string,
    printRet: (ret: Ret) => string,
    initialValues?: ValueMap<Args, Ret>,
    initialDependents?: DependentMap<Args, Ret>
}
const defaultOptions: ValueOfOptions<any, any> = {
    printArgs: (arg) => '' + arg,
    printRet: (ret) => '' + ret,
};
export function makeFixpointComputer<Args, Ret>(
    bottomRet: Ret,
    join: (a: Ret, b: Ret) => Ret,
    { printArgs, printRet }: ValueOfOptions<Args, Ret> = defaultOptions,
): { valueOf: (query: Computation<Args, Ret>) => Ret, push_cache: (comp: Computation<Args, Ret>, val: Ret) => void } {
    let values = Map<Computation<Args, Ret>, Ret>();
    let dependents = new Lookup<Computation<Args, Ret>, Computation<Args, Ret>>();
    let compsToDo = Set<Computation<Args, Ret>>();
    
    return {
        valueOf,
        push_cache,
    };

    function push_cache(comp: Computation<Args, Ret>, val: Ret) {
        const joinedVal = join(values.get(comp, bottomRet), val)
        if (valuesUpdated(values, comp, joinedVal)) {
            const thisDependents = dependents.get(comp)
            compsToDo = compsToDo.union(thisDependents);
        }
        values = values.set(comp, joinedVal);
    }

    function valueOf(
        query: Computation<Args, Ret>,
    ) {
        compsToDo = compsToDo.add(query);
        while (compsToDo.size !== 0) {
            const compToDo = compsToDo.last()!;
            compsToDo = compsToDo.delete(compToDo);
    
            evaluateComputation(compToDo);
        }
    
        return values.get(query, bottomRet);
    
        function evaluateComputation(comp: Computation<Args, Ret>) {
            const { func, args } = comp;
    
            let dependencyUsages = Set<Computation<Args, Ret>>();
            const fix_run: FixRunFunc<Args, Ret> = (func, args) => {
                const dependencyComp = Computation({func, args});
                dependencyUsages = dependencyUsages.add(dependencyComp);
    
                if (!values.has(dependencyComp)) {
                    if (!values.has(comp)) { // ensure no infinite recursion
                        values = values.set(comp, bottomRet);
                    }
                    evaluateComputation(dependencyComp);
                }
    
                return values.get(dependencyComp, bottomRet);
            }
    
            console.info(`${func.name}(${printArgs(args)})`);
            const results = func(args, fix_run, push_cache);
            console.info(`${func.name}(${printArgs(args)}) = ${printRet(results)}`);
    
            push_cache(comp, results);
            for (const dependency of dependencyUsages) {
                if (!dependents.get(dependency).has(comp)) {
                    dependents = dependents.add(dependency, comp);
                }
            }
        }
    }

    function valuesUpdated(map: Map<Computation<Args, Ret>, Ret>, key: Computation<Args, Ret>, value: Ret) {
        return !Immutable.is(map.get(key, bottomRet), value);
    }
}
