import type { App } from 'obsidian';

import { strictProxy } from '@mnaoumov/typescript-test-toolkit/strict-proxy';
import {
  describe,
  expect,
  it
} from 'vitest';

import { PluginSettings } from '../../plugin-settings.ts';
import {
  isDatePropertyName,
  isMatchingDatePropertyNames
} from './date-properties.ts';

describe('isMatchingDatePropertyNames', () => {
  it.each([
    ['date', 'date'],
    ['*Date', 'birthDate'],
    ['*Date', 'Date'],
    ['*DateTime', 'startDateTime'],
    ['date_*', 'date_of_birth'],
    ['*_of_*', 'date_of_birth'],
    ['a*b*c', 'abc'],
    [' ctime ', 'ctime']
  ])('should match %s against %s', (entry, propertyName) => {
    expect(isMatchingDatePropertyNames([entry], propertyName)).toBe(true);
  });

  it.each([
    ['date', 'Date'],
    ['*Date', 'update'],
    ['*Date', 'birthDateTime'],
    ['date_*', 'my_date_x'],
    ['a*b*c', 'acb'],
    ['ab*ba', 'aba'],
    ['', 'date'],
    ['  ', 'date']
  ])('should not match %s against %s', (entry, propertyName) => {
    expect(isMatchingDatePropertyNames([entry], propertyName)).toBe(false);
  });

  it('should match when any entry does', () => {
    expect(isMatchingDatePropertyNames(['date', '*Date', 'ctime'], 'ctime')).toBe(true);
    expect(isMatchingDatePropertyNames([], 'date')).toBe(false);
  });
});

describe('isDatePropertyName', () => {
  const assignedTypes: Record<string, string> = { created: 'datetime', due: 'date', status: 'text' };
  const app = strictProxy<App>({
    metadataTypeManager: strictProxy<App['metadataTypeManager']>({
      getAssignedWidget: (propertyName: string): null | string => assignedTypes[propertyName] ?? null
    })
  });
  const settings = new PluginSettings();

  it('should count a property by its assigned type or by its name', () => {
    expect(isDatePropertyName(app, settings, 'due')).toBe(true);
    expect(isDatePropertyName(app, settings, 'created')).toBe(true);
    expect(isDatePropertyName(app, settings, 'birthDate')).toBe(true);
    expect(isDatePropertyName(app, settings, 'status')).toBe(false);
    expect(isDatePropertyName(app, settings, 'title')).toBe(false);
  });
});
