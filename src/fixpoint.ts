import { ComparatorResult, SimpleSet } from 'typescript-super-set'
import { Lookup } from './lookup'
import { lexicographic, simpleSetComparator, stringCompare, structuralComparator } from './comparators'
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

export function valueOf<Args, Ret>(query: Computation<Args, Ret>, defaultRet: Ret): Ret {
    const values = new SimpleMap<Computation<Args, Ret>, Ret>(computationComparator, defaultRet);
    const dependents = new Lookup(computationComparator<Args, Ret>, computationComparator<Args, Ret>);
    const compsToDo = new SimpleSet(computationComparator<Args, Ret>, query);
    const invocation = Math.random() * 99;
    while (compsToDo.size() !== 0) {
        const compToDo = compsToDo.elements[0];
        compsToDo.delete(compToDo);

        const { func, args } = compToDo;
        const dependencyUsages = new SimpleSet(computationComparator<Args, Ret>);
        const fix_run: FixRunFunc<Args, Ret> = (func, args) => {
            const computation = {func, args};
            dependencyUsages.add(computation);
            return values.get(computation) ?? defaultRet;
        }
        const results = func(args, fix_run);
        console.info(results);
        if (valuesUpdated(values, compToDo, results)) {
            const thisDependents = dependents.get(compToDo)
            compsToDo.add(...thisDependents);
        }
        values.set(compToDo, results);
        for (const dependency of dependencyUsages) {
            if (!dependents.get(dependency).has(compToDo)) {
                dependents.add(dependency, compToDo);
                compsToDo.add(dependency);
            }
        }
    }

    return values.get(query) ?? defaultRet;
}
