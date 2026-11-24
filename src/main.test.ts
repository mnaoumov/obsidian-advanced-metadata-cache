import {
  describe,
  expect,
  it,
  vi
} from 'vitest';

import mainDefault from './main.ts';
import { Plugin } from './plugin.ts';

vi.mock('./styles/main.scss');

describe('main', () => {
  it('should re-export Plugin as default', () => {
    expect(mainDefault).toBe(Plugin);
  });
});
