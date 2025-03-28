import ts from 'typescript';
import { AbstractValue, botValue, isTop, joinValue, nodeValue, topValue, NodeLattice } from './abstract-values';
import { SimpleSet } from 'typescript-super-set';
import { unimplementedVal } from './util';
import { FixedEval } from './primops';
import { getBuiltInMethod, getBuiltInValueOfBuiltInConstructor, getProtoOf, isBuiltInConstructorShaped, resultOfPropertyAccess } from './value-constructors';
import { setSome } from './setUtil';
