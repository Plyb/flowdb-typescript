import ts from 'typescript';
import { botResult, objectResult, primopResult, result } from './abstract-results';
import { Primop } from './primops';
import { AbstractObject, anyStringValue, objectValue, primopValue } from './abstract-values';

export const zStringParse = (() => result(anyStringValue)) as Primop
const stringSchemaRef = ts.factory.createObjectLiteralExpression();
const stringSchemaValue: AbstractObject = {
        parse: primopValue('z.string.Parse')
}
export const zStringSchemaConstructor = (() => objectResult(stringSchemaRef, stringSchemaValue))
export const packageZod = objectResult(
    ts.factory.createObjectLiteralExpression(), // dummy
    {
        string: primopValue('z.string')
    }
)