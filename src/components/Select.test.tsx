import { fireEvent, render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import { Select } from './Select';

const options = [
  { value: 'a', label: '选项 A' },
  { value: 'b', label: '选项 B' },
];

describe('Select dropdown', () => {
  it('opens, selects an option and reports the change', () => {
    const onChange = vi.fn();
    render(<Select ariaLabel="测试" value="a" options={options} onChange={onChange} />);
    fireEvent.click(screen.getByRole('button', { name: '测试' }));
    fireEvent.click(screen.getByRole('option', { name: '选项 B' }));
    expect(onChange).toHaveBeenCalledWith('b');
  });

  it('opens when the trigger sits inside a label (label click forwarding must not double-toggle)', () => {
    const onChange = vi.fn();
    render(
      <label>
        <span>推理参数格式</span>
        <Select ariaLabel="测试" value="a" options={options} onChange={onChange} />
      </label>,
    );
    fireEvent.click(screen.getByRole('button', { name: '测试' }));
    expect(screen.getByRole('listbox')).toBeInTheDocument();
    fireEvent.click(screen.getByRole('option', { name: '选项 B' }));
    expect(onChange).toHaveBeenCalledWith('b');
  });
});
