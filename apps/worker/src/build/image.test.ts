import { describe, expect, it } from 'vitest';
import { resolveImagePort } from './image';

describe('resolveImagePort', () => {
  it('uses the port the image declares when none is configured', () => {
    expect(resolveImagePort(0, [80])).toMatchObject({ port: 80 });
    expect(resolveImagePort(0, [3000])).toMatchObject({ port: 3000 });
  });

  it('prefers a conventional web port when several are declared', () => {
    expect(resolveImagePort(0, [22, 8080, 50000]).port).toBe(8080);
    expect(resolveImagePort(0, [80, 443]).port).toBe(80);
    expect(resolveImagePort(0, [6379, 9999]).port).toBe(6379); // nothing conventional: lowest declared
  });

  it('asks for a port when the image declares none', () => {
    expect(() => resolveImagePort(0, [])).toThrow(/EXPOSE/);
  });

  it('never overrides an explicit port, but warns when the image disagrees', () => {
    expect(resolveImagePort(9000, [80]).port).toBe(9000);
    expect(resolveImagePort(9000, [80]).note).toMatch(/only declares 80/);
    expect(resolveImagePort(80, [80]).note).not.toMatch(/only declares/);
    expect(resolveImagePort(8081, []).port).toBe(8081);
  });
});
