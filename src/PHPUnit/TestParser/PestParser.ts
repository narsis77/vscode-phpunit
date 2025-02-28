import { basename, dirname, join, relative } from 'node:path';
import { Block, Call, Closure, Declaration, ExpressionStatement, Node, Program, String } from 'php-parser';
import { capitalize } from 'string-ts';
import { converter } from './Converter';
import { Parser } from './Parser';
import { TestDefinition, TestType } from './types';

export class PestParser extends Parser {
    parse(declaration: Declaration | Node, file: string): TestDefinition[] | undefined {
        const clazz = this.parseClass(declaration, file);

        clazz.children = this.parseDescribe(declaration, clazz);
        if (clazz.children.length <= 0) {
            return;
        }

        const namespace = this.generateNamespace(clazz.namespace);

        return namespace
            ? [{ ...namespace, children: [clazz] }]
            : [clazz];
    }

    private parseClass(declaration: Declaration | Node, file: string): TestDefinition {
        let relativePath = relative(this.root(), file);
        let baseName = basename(file, '.php');
        const dotPos = baseName.lastIndexOf('.');
        if (dotPos !== -1) {
            baseName = baseName.substring(0, dotPos);
        }
        relativePath = join(capitalize(dirname(relativePath)), baseName).replace(/\//g, '\\');
        relativePath = relativePath.replace(/%[a-fA-F0-9][a-fA-F0-9]/g, '');
        relativePath = relativePath.replace(/\\'|\\"/g, '');
        relativePath = relativePath.replace(/[^A-Za-z0-9\\]/, '');

        const type = TestType.class;
        const classFQN = 'P\\' + relativePath;
        const partsFQN = classFQN.split('\\');
        const className = partsFQN.pop()!;
        const namespace = partsFQN.join('\\');
        const id = converter.generateUniqueId({ type, classFQN });
        const label = converter.generateLabel({ type, classFQN, className });

        const { start, end } = this.parsePosition(declaration);

        return {
            type,
            id,
            label,
            classFQN,
            namespace,
            className,
            file,
            start,
            end,
        };
    }

    private parseDescribe(declaration: Call | Block | Node, clazz: any, prefixes: string[] = []): TestDefinition[] {
        let children: any[];
        if (declaration.kind === 'program') {
            children = (declaration as Program).children;
        } else {
            children = ((declaration as Call).arguments[1] as Closure).body!.children!;
            prefixes = [...prefixes, ((declaration as Call).arguments[0] as String).value];
        }

        return children
            .filter((expressionStatement: ExpressionStatement) => expressionStatement.expression)
            .map((expressionStatement: any) => expressionStatement.expression)
            .filter((call: Call) => ['describe', 'test', 'it'].includes(this.parseName(call) ?? ''))
            .reduce((tests: TestDefinition[], call: Call) => {
                return this.parseName(call) === 'describe'
                    ? [...tests, ...this.parseDescribe(call, clazz, prefixes)]
                    : [...tests, this.parseTestOrIt(call, clazz, prefixes)];
            }, []);
    }

    private parseTestOrIt(call: Call, clazz: TestDefinition, prefixes: string[] = []): TestDefinition {
        if (call.what.kind === 'propertylookup') {
            return this.parseTestOrIt(((call.what as any).what) as Call, clazz, prefixes);
        }

        let methodName = (call.arguments[0] as String).value;

        if (this.parseName(call) === 'it') {
            methodName = 'it ' + methodName;
        }

        if (prefixes.length > 0) {
            methodName = [...prefixes.map((value) => '`' + value + '`'), methodName].join(' → ');
        }

        const type = TestType.method;
        const id = converter.generateUniqueId({ ...clazz, type, methodName });
        const label = converter.generateLabel({ ...clazz, type, methodName });
        const { start, end } = this.parsePosition(call);

        return { ...clazz, type, id, label, methodName, start, end };
    }
}