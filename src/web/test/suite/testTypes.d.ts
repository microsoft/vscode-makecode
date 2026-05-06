/// <reference types="mocha" />

declare module "assert" {
    export function deepStrictEqual(actual: unknown, expected: unknown, message?: string | Error): void;
    export function ok(value: unknown, message?: string | Error): void;
}
