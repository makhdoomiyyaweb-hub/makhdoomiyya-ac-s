import AdvancedDateFilter from './AdvancedDateFilter';
import Input from './Input';
import Button from './Button';

export default function RecordFilters({ query, onQueryChange, range, onRangeChange, count }) {
  return (
    <div className="p-3 sm:px-6 border-b border-border space-y-2">
      <div className="flex flex-wrap items-center gap-2">
        <Input name="record-search" aria-label="Search records" type="search" value={query}
          onChange={e => onQueryChange(e.target.value)} placeholder="Search name, receipt, category, item…"
          className="flex-1 min-w-[180px]" />
        <AdvancedDateFilter value={range || { label: 'All dates' }} onChange={onRangeChange} />
        {(query || range) && <Button variant="ghost" onClick={() => { onQueryChange(''); onRangeChange(null); }}>Clear</Button>}
      </div>
      <p className="text-xs text-muted" aria-live="polite">{count} matching records</p>
    </div>
  );
}
