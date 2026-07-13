import React, { useMemo } from 'react';
import { Category } from '../types';
import { getIcon } from '../utils/icons';
import { PASTEL_SWATCHES as PRESET_COLORS } from '../utils/palette';
import { getActiveCategories } from '../utils/categoryVisibility';

type SwatchSize = 'sm' | 'md';

const getColorSwatchClass = (selected: boolean, size: SwatchSize) => {
  const baseSize = size === 'sm' ? 'w-4 h-4' : 'w-5 h-5';
  return `${baseSize} rounded-full transform-gpu transition-all duration-300 ease-out ${
    selected
      ? 'ring-2 ring-white ring-offset-1 ring-offset-transparent shadow-[0_0_12px_rgba(255,255,255,0.25)] scale-105'
      : 'opacity-75 hover:opacity-100 hover:-translate-y-[1px] hover:scale-110 hover:shadow-[0_0_10px_rgba(255,255,255,0.18)] active:scale-95'
  }`;
};

interface TaskCategoryPickerProps {
  categories: Category[];
  selectedCategoryId: number | null;
  selectedColor: string;
  onColorSelect: (color: string) => void;
  onCategorySelect: (category: Category) => void;
  onRequestNewCategory: () => void;
  swatchSize?: SwatchSize;
  className?: string;
  chipTextClassName?: string;
  stretchCategoryTray?: boolean;
}

const TaskCategoryPicker: React.FC<TaskCategoryPickerProps> = ({
  categories,
  selectedCategoryId,
  selectedColor,
  onColorSelect,
  onCategorySelect,
  onRequestNewCategory,
  swatchSize = 'sm',
  className = '',
  chipTextClassName = 'text-[9px]',
  stretchCategoryTray = true,
}) => {
  const activeCategories = useMemo(() => getActiveCategories(categories), [categories]);
  const hasActiveSelectedCategory = activeCategories.some((category) => category.id === selectedCategoryId);
  const trayClassName = stretchCategoryTray
    ? 'min-w-0 flex-1'
    : 'min-w-0 max-w-full flex-[0_1_auto]';

  return (
    <div className={`flex min-w-0 items-center gap-2 ${className}`.trim()}>
      <div className="flex shrink-0 gap-1.5 px-0.5 py-0.5">
        {PRESET_COLORS.map((color) => (
          <button
            key={color}
            type="button"
            onClick={() => onColorSelect(color)}
            className={getColorSwatchClass(selectedColor === color && !hasActiveSelectedCategory, swatchSize)}
            style={{ backgroundColor: color }}
            aria-label={`Pick color ${color}`}
          />
        ))}
      </div>

      {activeCategories.length > 0 ? (
        <div className={`${trayClassName} overflow-x-auto rounded-xl border border-white/10 bg-black/10 p-1.5 scrollbar-hide`}>
          <div className="flex w-max gap-1 pr-1">
            {activeCategories.map((category) => (
              <button
                key={category.id}
                type="button"
                onClick={() => onCategorySelect(category)}
                className={`shrink-0 flex items-center gap-1 rounded-full border px-2 py-0.5 transition-all ${
                  selectedCategoryId === category.id
                    ? 'bg-white/20 border-white/40'
                    : 'bg-white/5 border-white/10 opacity-60 hover:opacity-100'
                }`}
              >
                <div className="w-3 h-3 text-white" style={{ color: category.color }}>
                  {getIcon(category.icon, { size: 12 })}
                </div>
                <span className={`${chipTextClassName} text-white font-bold`}>{category.name}</span>
              </button>
            ))}
          </div>
        </div>
      ) : (
        <div className={`${trayClassName} rounded-xl border border-white/10 bg-black/10 p-1.5`}>
          <button
            type="button"
            onClick={onRequestNewCategory}
            className="flex w-fit items-center gap-1 rounded-full border border-white/10 bg-white/5 px-2 py-0.5 transition-all opacity-60 hover:opacity-100"
          >
            <div className="w-3 h-3 flex items-center justify-center text-white/80">
              <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
                <path d="M12 5v14" />
                <path d="M5 12h14" />
              </svg>
            </div>
            <span className={`${chipTextClassName} text-white font-bold`}>Add Category</span>
          </button>
        </div>
      )}
    </div>
  );
};

export default TaskCategoryPicker;
