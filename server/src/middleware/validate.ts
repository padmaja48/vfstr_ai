import { RequestHandler } from 'express';
import { AnyZodObject } from 'zod';

export const validate =
  (schema: AnyZodObject): RequestHandler =>
  (req, _res, next) => {
    const result = schema.parse({
      body: req.body,
      params: req.params,
      query: req.query,
    });

    req.body = result.body ?? req.body;
    req.params = result.params ?? req.params;
    req.query = result.query ?? req.query;
    next();
  };
