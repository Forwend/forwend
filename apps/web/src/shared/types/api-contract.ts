import type { z } from "zod";
import type { paths } from "@/shared/types/openapi.gen";

export type ApiPath = keyof paths;
type Method = "get" | "put" | "post" | "delete";
type Operation<P extends ApiPath, M extends Method> = NonNullable<paths[P][M]>;
type Json<T> = T extends { content: { "application/json": infer Body } } ? Body : never;
type Success = 200 | 201 | 202;

/** Every JSON body a success answer of the route may carry, per openapi.yaml. */
export type ApiAnswer<P extends ApiPath, M extends Method> = Json<
  Operation<P, M>["responses"][keyof Operation<P, M>["responses"] & Success]
>;

/** The JSON body the route takes, per openapi.yaml. */
export type ApiBody<P extends ApiPath, M extends Method> = Json<
  NonNullable<Operation<P, M>["requestBody"]>
>;

/** True when the schema parses every answer the spec allows. */
export type Accepts<Schema extends z.ZodType, Answer> = [Answer] extends [never]
  ? false
  : [Answer] extends [z.input<Schema>]
    ? true
    : false;

/** True when every value the schema produces is a body the spec takes. */
export type Sends<Schema extends z.ZodType, Body> = [z.output<Schema>] extends [Body]
  ? true
  : false;

export type Check<T extends true> = T;
