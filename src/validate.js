/**
 * Small declarative validator. A schema is a list of field specs:
 *   { key, col, type: 'text'|'url'|'enum'|'int'|'num'|'bool'|'date'|'datetime', max, min, values, required, fallback }
 * `key` is the JSON name, `col` the SQL column. Unknown fields are ignored.
 */
function validate(schema, body, { partial = false } = {}) {
  const out = {};
  const b = body && typeof body === 'object' ? body : {};
  for (const f of schema) {
    const present = Object.prototype.hasOwnProperty.call(b, f.key);
    if (!present) {
      if (!partial && f.required) return { error: `${label(f)} is required.` };
      if (!partial && f.fallback !== undefined) out[f.col] = typeof f.fallback === 'function' ? f.fallback() : f.fallback;
      continue;
    }
    let v = b[f.key];
    const blank = v === '' || v === null || v === undefined;
    switch (f.type) {
      case 'text':
      case 'url': {
        v = blank ? '' : String(v).trim();
        if (f.required && !v) return { error: `${label(f)} is required.` };
        if (v.length > (f.max || 200)) return { error: `${label(f)} is too long (max ${f.max || 200} characters).` };
        if (f.type === 'url' && v && !/^https?:\/\//i.test(v)) return { error: `${label(f)} must start with http:// or https://` };
        out[f.col] = v;
        break;
      }
      case 'enum':
        if (blank && f.fallback !== undefined) { out[f.col] = f.fallback; break; }
        if (!f.values.includes(v)) return { error: `${label(f)} must be one of: ${f.values.join(', ')}.` };
        out[f.col] = v;
        break;
      case 'int':
      case 'num': {
        if (blank) {
          if (f.required) return { error: `${label(f)} is required.` };
          out[f.col] = f.nullable === false ? (f.fallback ?? 0) : null;
          break;
        }
        const n = Number(v);
        if (!Number.isFinite(n) || (f.type === 'int' && !Number.isInteger(n))) return { error: `${label(f)} must be a number.` };
        if (n < (f.min ?? -Infinity) || n > (f.max ?? Infinity)) return { error: `${label(f)} must be between ${f.min} and ${f.max}.` };
        out[f.col] = n;
        break;
      }
      case 'bool':
        out[f.col] = v === true || v === 1 || v === 'true' ? 1 : 0;
        break;
      case 'date':
      case 'datetime': {
        if (blank) {
          if (f.required) return { error: `${label(f)} is required.` };
          out[f.col] = f.type === 'datetime' ? new Date().toISOString() : null;
          break;
        }
        const d = new Date(v);
        if (Number.isNaN(d.getTime())) return { error: `${label(f)} is not a valid date.` };
        out[f.col] = f.type === 'date' ? d.toISOString().slice(0, 10) : d.toISOString();
        break;
      }
      default:
        throw new Error(`unknown field type ${f.type}`);
    }
  }
  return { values: out };
}

const label = (f) => f.label || f.key.replace(/([A-Z])/g, ' $1').replace(/^./, (c) => c.toUpperCase());

module.exports = { validate };
