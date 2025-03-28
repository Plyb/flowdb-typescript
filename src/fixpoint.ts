import { ComparatorResult, SimpleSet } from 'typescript-super-set'
import { Lookup } from './lookup'
import { lexicographic, stringCompare, structuralComparator } from './comparators'
import { SimpleMap } from './simple-map'

type Fixable<Args, Ret> = (args: Args, fix_run: FixRunFunc<Args, Ret>) => Ret
export type LabeledFixable<Args, Ret> = Fixable<Args, Ret> & { name: string}
export type FixRunFunc<Args, Ret> = (func: LabeledFixable<Args, Ret>, args: Args) => Ret
type Computation<Args, Ret> = { func: LabeledFixable<Args, Ret>, args: Args }

function labeledFixableComparator<Args, Ret>(a: LabeledFixable<Args, Ret>, b: LabeledFixable<Args, Ret>) {
    return stringCompare(a.name, b.name);
}

function computationComparator<Args, Ret>(a: Computation<Args, Ret>, b: Computation<Args, Ret>): ComparatorResult {
    return lexicographic(
        (a: Computation<Args, Ret>, b) => labeledFixableComparator(a.func, b.func),
        (a: Computation<Args, Ret>, b) => structuralComparator(a.args, b.args)
    )(a, b);
}

function valuesUpdated<K, V>(map: SimpleMap<K, V>, key: K, value: V) {
    return structuralComparator(map.get(key), value) !== 0;
}

type ValueMap<Args, Ret> = SimpleMap<Computation<Args, Ret>, Ret>
type DependentMap<Args, Ret> = Lookup<Computation<Args, Ret>, Computation<Args, Ret>>
type ValueOfOptions<Args extends object, Ret extends object> = {
    printArgs: (arg: Args) => string,
    printRet: (ret: Ret) => string,
    initialValues?: ValueMap<Args, Ret>,
    initialDependents?: DependentMap<Args, Ret>
}
const defaultOptions: ValueOfOptions<any, any> = {
    printArgs: (arg) => arg.toString(),
    printRet: (ret) => ret.toString(),
};
export function makeFixpointComputer<Args extends object, Ret extends object>(
    defaultRet: Ret,
    { printArgs, printRet }: ValueOfOptions<Args, Ret> = defaultOptions,
): (query: Computation<Args, Ret>) => Ret {
    const values = new SimpleMap<Computation<Args, Ret>, Ret>(computationComparator, defaultRet);
    const dependents = new Lookup(computationComparator<Args, Ret>, computationComparator<Args, Ret>);
    return function valueOf(
        query: Computation<Args, Ret>,
    ) {
        const compsToDo = new SimpleSet(computationComparator<Args, Ret>, query);
        while (compsToDo.size() !== 0) {
            const compToDo = compsToDo.elements[0];
            compsToDo.delete(compToDo);
    
            evaluateComputation(compToDo);
        }
    
        return values.get(query) ?? defaultRet;
    
        function evaluateComputation(comp: Computation<Args, Ret>) {
            const { func, args } = comp;
    
            const dependencyUsages = new SimpleSet(computationComparator<Args, Ret>);
            const fix_run: FixRunFunc<Args, Ret> = (func, args) => {
                const dependencyComp = {func, args};
                dependencyUsages.add(dependencyComp);
    
                if (!values.has(dependencyComp)) {
                    if (!values.has(comp)) { // ensure no infinite recursion
                        values.set(comp, defaultRet);
                    }
                    evaluateComputation(dependencyComp);
                }
    
                return values.get(dependencyComp) ?? defaultRet;
            }
    
            console.info(`${func.name}(${printArgs(args)})`);
            const results = func(args, fix_run);
            console.info(`${func.name}(${printArgs(args)}) = ${printRet(results)}`);
    
            if (valuesUpdated(values, comp, results)) {
                const thisDependents = dependents.get(comp)
                compsToDo.add(...thisDependents);
            }
            values.set(comp, results);
            for (const dependency of dependencyUsages) {
                if (!dependents.get(dependency).has(comp)) {
                    dependents.add(dependency, comp);
                }
            }
        }
    }
}
