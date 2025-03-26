import ts, { ArrayLiteralExpression, CallExpression, NewExpression, ObjectLiteralExpression, PropertyAccessExpression, SyntaxKind } from 'typescript';
import { FixedEval, PrimopApplication, PrimopId, primops} from './primops';
import { AtomicLiteral, isAsync, isBooleaniteral, isFunctionLikeDeclaration, isLiteral } from './ts-utils';
import { empty, setFilter, setFlatMap, setMap, singleton } from './setUtil';
import { SimpleSet } from 'typescript-super-set';
import { isTop, nodeLatticeFlatMap, top } from './abstract-values';
import { structuralComparator } from './comparators';

type ValueConstructor =
| AtomicLiteral
| ObjectLiteralExpression
| ArrayLiteralExpression
| NewExpression
| AsyncFunctionCall
| PrimopApplication
| PrimopExpression;
type PrimopExpression = PropertyAccessExpression | ts.BinaryExpression;
type AsyncFunctionCall = CallExpression

type BuiltInType =
| 'string'
| 'number'
| 'boolean'
| 'date'
| 'regexp'
| 'object'
| 'promise'
| 'array'
| 'map';

const allTypes = new SimpleSet<BuiltInType>(structuralComparator,
    'string', 'number', 'boolean', 'date', 'regexp', 'object', 'promise', 'array', 'map');

export function getTypesOf(cons: ValueConstructor, fixed_eval: FixedEval, printNodeAndPos: (node: ts.Node) => string): SimpleSet<BuiltInType> {
    if (ts.isStringLiteral(cons) || ts.isTemplateLiteral(cons)) {
        return singleton<BuiltInType>('string');
    } else if (ts.isNumericLiteral(cons)) {
        return singleton<BuiltInType>('number');
    } else if (isBooleaniteral(cons)) {
        return singleton<BuiltInType>('boolean');
    } else if (ts.isRegularExpressionLiteral(cons)) {
        return singleton<BuiltInType>('regexp');
    } else if (ts.isObjectLiteralExpression(cons)) {
        return singleton<BuiltInType>('object');
    } else if (ts.isArrayLiteralExpression(cons)) {
        return singleton<BuiltInType>('array');
    } else if (ts.isNewExpression(cons)) {
        if (!(ts.isIdentifier(cons.expression) && cons.expression.text === 'Map')) {
            console.warn(`New expression not yet implemented for ${printNodeAndPos(cons.expression)}`)
            return empty();
        }
        return singleton<BuiltInType>('map')
    } else if (ts.isCallExpression(cons)) {
        const expressionValues = fixed_eval(cons.expression).value.nodes;
        return setFlatMap(expressionValues, val => {
            if (isTop(val)) {
                return allTypes;
            }

            if (isFunctionLikeDeclaration(val)) {
                if (!isAsync(val)) {
                    console.warn(`Only async function calls can be value constructors: ${printNodeAndPos(val)}`);
                    return empty();
                }

                const bodyValues = fixed_eval(val.body).value.nodes;
                return setFlatMap(bodyValues, bodyValue => {
                    if (isTop(bodyValue)) {
                        return allTypes;
                    }

                    if (!isValueConstructor(bodyValue)) {
                        console.warn(`Expected value constructor: ${printNodeAndPos(bodyValue)}`)
                        return empty();
                    }
                    return getTypesOf(bodyValue, fixed_eval, printNodeAndPos);
                })
            } else if (ts.isPropertyAccessExpression(val)) { // todo is primop expression
                const primops = getPrimops(val, fixed_eval, printNodeAndPos);
                return setFlatMap(primops, primop => {
                    const retType = primopReturnTypes.get(primop);
                    if (retType === undefined) {
                        throw new Error(`Unable to get return type for primop ${primop} at ${printNodeAndPos(cons)}`)
                    }
                    return retType;
                });
            }

            console.warn(`Unable to get type for call expression ${printNodeAndPos(cons)}`);
            return empty();
        })
    } else if (ts.isBinaryExpression(cons)) {
        const primops = getPrimops(cons, fixed_eval, printNodeAndPos);
        return setFlatMap(primops, primop => { // TODO: unify this with the above
            const retType = primopReturnTypes.get(primop);
            if (retType === undefined) {
                throw new Error(`Unable to get return type for primop ${primop} at ${printNodeAndPos(cons)}`)
            }
            return retType;
        });
    }
    console.warn(`Unable to get type for ${printNodeAndPos(cons)}`);
    return empty();
}

const primopReturnTypes = new Map<PrimopId, SimpleSet<BuiltInType>>([
    ['Math.floor', singleton<BuiltInType>('number')],
    ['String#includes', singleton<BuiltInType>('boolean')],
    ['String#substring', singleton<BuiltInType>('string')],
    ['String#split', singleton<BuiltInType>('array')],
    ['String#trim', singleton<BuiltInType>('string')],
    ['String#toLowerCase', singleton<BuiltInType>('string')],
    ['fetch', singleton<BuiltInType>('object')],
    ['JSON.parse', allTypes],
    ['Date.now', singleton<BuiltInType>('date')],
    ['String#match', singleton<BuiltInType>('array')],
    ['Array#map', singleton<BuiltInType>('array')],
    ['Array#filter', singleton<BuiltInType>('array')],
    ['Array#indexOf', singleton<BuiltInType>('number')],
    ['Array#some', singleton<BuiltInType>('boolean')],
    ['Array#includes', singleton<BuiltInType>('boolean')],
    ['Array#find', allTypes], // TODO: we should be able to do these better
    ['Map#keys', allTypes],
    ['Map#get', allTypes],
    ['Map#set', singleton<BuiltInType>('map')],
    ['Object.freeze', singleton<BuiltInType>('object')],
    [SyntaxKind.QuestionQuestionToken, allTypes],
    [SyntaxKind.BarBarToken, allTypes],
    ['RegExp#test', singleton<BuiltInType>('boolean')],
]);

function filterMethods(type: string): SimpleSet<PrimopId> {
    return new SimpleSet<PrimopId>(
        structuralComparator,
        ...[...Object.keys(primops) as Iterable<PrimopId>].filter(method => typeof method === 'string' && method.split('#')[0] === type)
    );
}
const builtInMethodsByType = new Map<BuiltInType, SimpleSet<PrimopId>>([
    ['string', filterMethods('String')],
    ['array', filterMethods('Array')],
    ['map', filterMethods('Map')]
])

export function getPrimops(primopExpression: PrimopExpression, fixed_eval: FixedEval, printNodeAndPos: (node: ts.Node) => string): SimpleSet<PrimopId> {
    if (ts.isPropertyAccessExpression(primopExpression)) {
        const thisExpression = primopExpression.expression;
        const thisValues = fixed_eval(thisExpression).value.nodes;
        return setFlatMap(thisValues, thisValue => {
            if (isTop(thisValue)) {
                return new SimpleSet<PrimopId>(structuralComparator, ...Object.keys(primops) as Iterable<PrimopId>); // TODO: this includes binary operators 
            }
            if (!isValueConstructor(thisValue)) {
                console.warn(`Expected value constructor: ${printNodeAndPos(thisValue)}`);
                return empty();
            }
            const thisTypes = getTypesOf(thisValue, fixed_eval, printNodeAndPos);
            return setFlatMap(thisTypes, thisType => {
                const methodsForType = builtInMethodsByType.get(thisType);
                if (methodsForType === undefined) {
                    console.warn(`No methods found for type ${thisType}`);
                    return empty();
                }
                return setFilter(methodsForType, method => typeof method === 'string' && method.split('#')[1] === primopExpression.name.text);
            })
        })
    } else { // binary expression
        const operator = primopExpression.operatorToken;
        return singleton<PrimopId>(operator.kind);
    }
}

function isValueConstructor(node: ts.Node): node is ValueConstructor {
    return isLiteral(node)
        || ts.isObjectLiteralExpression(node)
        || ts.isArrayLiteralExpression(node)
        || ts.isNewExpression(node)
        || ts.isCallExpression(node)
        || ts.isPropertyAccessExpression(node);
}
