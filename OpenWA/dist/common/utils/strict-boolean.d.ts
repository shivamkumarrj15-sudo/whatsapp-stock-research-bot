import { TransformFnParams } from 'class-transformer';
export declare function coerceStrictBoolean({ obj, key }: Pick<TransformFnParams, 'obj' | 'key'>): unknown;
export declare const ToStrictBoolean: () => PropertyDecorator;
export declare function coerceStrictNumber({ obj, key }: Pick<TransformFnParams, 'obj' | 'key'>): unknown;
export declare const ToStrictNumber: () => PropertyDecorator;
