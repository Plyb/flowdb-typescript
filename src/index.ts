import ts from 'typescript';
import * as path from 'path';
import fs from 'fs';
import { dcfa } from './dcfa';
import { pretty } from './abstract-results';
import { analyze } from './analysis';
import { getNodeAtPosition } from './ts-utils';

const rootFolder = path.resolve(__dirname, '../../example')
const configFile = ts.readConfigFile(path.join(rootFolder, 'tsconfig.json'), ts.sys.readFile);
const { options, fileNames } = ts.parseJsonConfigFileContent(configFile.config, ts.sys, rootFolder);
const program = ts.createProgram(fileNames, {...options, noLib: true, noResolve: true, types: []});

function toSimpleAst(node: ts.Node, sourceFile: ts.SourceFile) {
  const children = node.getChildren(sourceFile);
  const kind = ts.SyntaxKind[node.kind];
  if (children.length === 0) {
    return {
      kind,
      text: node.getText(sourceFile),
    }
  } else {
    return {
      kind,
      children: children.map(child => toSimpleAst(child, sourceFile)),
    }
  }
}

// const sf = program.getSourceFiles()[0];
// console.log(toSimpleAst(sf, sf));

const files: ts.MapLike<{version: number}> = Object
  .fromEntries(fileNames.map(fileName => [fileName, { version: 0 }]));
const servicesHost: ts.LanguageServiceHost = {
  getScriptFileNames: () => fileNames,
  getScriptVersion: fileName =>
    files[fileName] && files[fileName].version.toString(),
  getScriptSnapshot: fileName => {
    if (!fs.existsSync(fileName)) {
      return undefined;
    }

    return ts.ScriptSnapshot.fromString(fs.readFileSync(fileName).toString());
  },
  getCurrentDirectory: () => process.cwd(),
  getCompilationSettings: () => ({...options, noLib: true, noResolve: true, types: []}),
  getDefaultLibFileName: options => ts.getDefaultLibFilePath(options),
  fileExists: ts.sys.fileExists,
  readFile: ts.sys.readFile,
  readDirectory: ts.sys.readDirectory,
  directoryExists: ts.sys.directoryExists,
  getDirectories: ts.sys.getDirectories,
};
const service = ts.createLanguageService(servicesHost, ts.createDocumentRegistry());
const sf = service.getProgram()?.getSourceFiles()[0]!;

function prettyInfo(item) {
  if (typeof item === 'object') {
    console.log(pretty(item, sf));
  } else {
    console.log(item);
  }
}

console.info = () => undefined
// console.info = prettyInfo


const pos = sf.getPositionOfLineAndCharacter(5, 11);
const node = getNodeAtPosition(sf, pos)!;
const results = dcfa(node, service);
console.log(pretty(results, sf));

// const results = analyze(service, 3, 6);
// console.log(results)
