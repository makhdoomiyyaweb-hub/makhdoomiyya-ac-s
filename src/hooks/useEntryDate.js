import { useState } from 'react';
import { localToday, readEntryDate, validEntryDate, writeEntryDate } from '../utils/entryDate';

export function useEntryDate(key) {
  const [dates, setDates] = useState({});
  const date = dates[key] ?? readEntryDate(key, localToday());

  const changeDate = value => {
    if (!validEntryDate(value)) return;
    writeEntryDate(key, value);
    setDates(previous => ({ ...previous, [key]: value }));
  };

  return [date, changeDate];
}
