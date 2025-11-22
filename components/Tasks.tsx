
import React, { useState } from 'react';
import { useTimer } from '../context/TimerContext';
import { Task } from '../types';

const PRESET_COLORS = [
  '#BA4949', // Red
  '#38858a', // Teal
  '#397097', // Blue
  '#8c5e32', // Sienna 
  '#7a5c87', // Purple
  '#547a59', // Green
];

const TaskItem: React.FC<{ task: Task, depth?: number, isSectionActive: boolean }> = ({ task, depth = 0, isSectionActive }) => {
  const { updateTask, deleteTask, selectTask, toggleTaskExpansion, addTask } = useTimer();
  const [isEditing, setIsEditing] = useState(false);
  const [editName, setEditName] = useState(task.name);
  const [editEst, setEditEst] = useState(task.estimated);
  const [isAddingSub, setIsAddingSub] = useState(false);
  const [subName, setSubName] = useState('');
  const [subEst, setSubEst] = useState(1);

  const handleCheck = (e: React.MouseEvent) => {
    e.stopPropagation();
    updateTask({ ...task, checked: !task.checked });
  };

  const handleSave = () => {
    updateTask({ ...task, name: editName, estimated: editEst });
    setIsEditing(false);
  };

  const handleAddSubtask = (e: React.FormEvent) => {
    e.preventDefault();
    if (!subName.trim()) return;
    addTask(subName, subEst, task.categoryId, task.id);
    setSubName('');
    setSubEst(1);
    setIsAddingSub(false);
  };

  const containerMargin = depth === 0 ? 'mb-3' : 'mb-2';

  if (isEditing) {
    return (
      <div className={`p-2 bg-white/10 rounded-lg ${containerMargin} flex gap-2 items-center animate-fade-in backdrop-blur-md border border-white/20`} style={{ marginLeft: depth * 16 }}>
        <input 
          autoFocus
          value={editName} 
          onChange={e => setEditName(e.target.value)}
          className="flex-1 bg-transparent border-b border-white/30 px-2 py-1 text-glass-text outline-none focus:border-white text-sm" 
        />
        <input 
          type="number" 
          value={editEst} 
          onChange={e => setEditEst(Number(e.target.value))}
          className="w-10 bg-transparent border-b border-white/30 px-1 py-1 text-glass-text text-center outline-none focus:border-white font-mono text-sm"
          min="0" max="99"
        />
        <button onClick={handleSave} className="p-1.5 bg-white/10 rounded text-green-400 hover:bg-green-500/20 transition-colors">✓</button>
      </div>
    );
  }

  return (
    <div className={`flex flex-col ${containerMargin} ${depth === 0 ? 'mt-2' : ''} relative`}>
      <div 
        onClick={() => selectTask(task.id)}
        className={`
          group relative rounded-lg cursor-pointer transition-all duration-500 ease-out
          flex items-center gap-3 border
          ${depth === 0 ? 'p-3' : 'p-2.5'}
          ${task.selected && isSectionActive
            ? 'bg-white/20 border-white/30 shadow-lg scale-[1.01] z-20 blur-0 opacity-100' 
            : 'bg-white/5 border-transparent z-10' // Base state
          }
          ${!isSectionActive 
            ? 'blur-[1px] opacity-70 hover:blur-0 hover:opacity-100' 
            : (task.selected ? '' : 'hover:bg-white/10 hover:border-white/10 hover:shadow-md opacity-80 hover:opacity-100')
          }
          ${task.checked ? 'opacity-40' : ''}
        `}
      >
        {/* Selection Indicator */}
        {task.selected && isSectionActive && <div className="absolute left-0 inset-y-2 w-1 bg-white rounded-r-full shadow-[0_0_10px_rgba(255,255,255,0.5)]" />}
        
        {/* Expand/Collapse */}
        {task.subtasks.length > 0 ? (
          <button 
            onClick={(e) => { e.stopPropagation(); toggleTaskExpansion(task.id); }}
            className="p-1 text-white/40 hover:text-white transition-colors z-20 rounded hover:bg-white/10"
          >
            <svg 
              className={`w-3 h-3 transition-transform duration-300 ${task.isExpanded ? 'rotate-90' : ''}`} 
              fill="currentColor" viewBox="0 0 24 24"
            >
              <path d="M8 5v14l11-7z"/>
            </svg>
          </button>
        ) : (
          <div className="w-3 h-3 px-1" />
        )}

        {/* Check Circle */}
        <div 
          onClick={handleCheck}
          className={`
            rounded-full border flex items-center justify-center transition-all duration-300 shrink-0 z-20
            ${depth === 0 ? 'w-5 h-5 border-[1.5px]' : 'w-4 h-4 border'}
            ${task.checked 
              ? 'bg-white border-white' 
              : 'border-white/30 hover:border-white group-hover:bg-white/10'
            }
          `}
        >
          {task.checked && <svg className="w-3 h-3 text-black" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth="4"><path strokeLinecap="round" strokeLinejoin="round" d="M5 13l4 4L19 7" /></svg>}
        </div>
        
        {/* Task Name */}
        <div className="flex-1 min-w-0 flex flex-col justify-center">
          <div className={`text-glass-text truncate transition-colors ${task.checked ? 'line-through' : 'group-hover:text-white'} ${depth === 0 ? 'font-medium text-sm' : 'text-xs'}`}>
            {task.name}
          </div>
          {task.color && depth === 0 && !task.checked && (
             <div className="w-full max-w-[60px] h-[2px] mt-1.5 rounded-full opacity-60 group-hover:opacity-100 transition-opacity" style={{ backgroundColor: task.color }} />
          )}
        </div>

        {/* Estimate Pill */}
        <div className="text-glass-textMuted font-mono text-[10px] bg-black/20 px-2 py-0.5 rounded-md backdrop-blur-sm group-hover:bg-black/30 transition-colors border border-white/5">
          <span className={task.completed >= task.estimated ? 'text-green-400 font-bold' : ''}>{task.completed}</span>
          <span className="opacity-40 mx-0.5">/</span>
          <span>{task.estimated}</span>
        </div>

        {/* Actions (Hover) */}
        <div className="flex gap-0.5 opacity-0 group-hover:opacity-100 transition-all duration-300">
           <button 
             onClick={(e) => { e.stopPropagation(); setIsAddingSub(true); updateTask({ ...task, isExpanded: true }); }} 
             className="p-1.5 text-glass-text hover:text-white hover:bg-white/10 rounded transition-colors" title="Add Subtask"
           >
             <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><path d="M12 5v14M5 12h14"/></svg>
           </button>
          <button onClick={(e) => { e.stopPropagation(); setIsEditing(true); }} className="p-1.5 text-glass-text hover:text-white hover:bg-white/10 rounded transition-colors" title="Edit">
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><path d="M11 4H4a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2v-7"/><path d="M18.5 2.5a2.121 2.121 0 0 1 3 3L12 15l-4 1 1-4 9.5-9.5z"/></svg>
          </button>
          <button onClick={(e) => { e.stopPropagation(); deleteTask(task.id); }} className="p-1.5 text-glass-text hover:text-red-300 hover:bg-red-500/20 rounded transition-colors" title="Delete">
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/></svg>
          </button>
        </div>
      </div>

      {/* Subtasks */}
      <div className="pl-6 md:pl-8">
        {isAddingSub && (
          <form onSubmit={handleAddSubtask} className="flex gap-2 p-2 mb-2 bg-white/5 rounded-lg border border-white/10 animate-slide-up backdrop-blur-sm">
            <input 
              autoFocus
              type="text" 
              placeholder="Subtask..." 
              className="flex-1 bg-transparent px-2 py-0.5 text-xs text-glass-text placeholder-white/30 outline-none"
              value={subName}
              onChange={e => setSubName(e.target.value)}
            />
            <input 
              type="number" 
              min="0" max="10"
              className="w-8 bg-transparent text-center text-xs text-glass-text font-mono outline-none border-l border-white/10"
              value={subEst}
              onChange={e => setSubEst(Number(e.target.value))}
            />
            <button type="submit" className="text-green-400 px-1 hover:scale-110 transition-transform">✓</button>
          </form>
        )}

        {task.isExpanded && task.subtasks.length > 0 && (
          <div className="animate-slide-up relative border-l border-white/10 pl-4 mt-1 space-y-1">
            {task.subtasks.map(sub => (
              <TaskItem key={sub.id} task={sub} depth={depth + 1} isSectionActive={isSectionActive} />
            ))}
          </div>
        )}
      </div>
    </div>
  );
};

const Tasks: React.FC = () => {
  const { tasks, addTask, selectedCategoryId } = useTimer();
  const [newName, setNewName] = useState('');
  const [newEst, setNewEst] = useState(1);
  const [newColor, setNewColor] = useState(PRESET_COLORS[0]);
  const [isInputFocused, setIsInputFocused] = useState(false);
  const [isHovered, setIsHovered] = useState(false); 

  const filteredTasks = selectedCategoryId 
    ? tasks.filter(t => t.categoryId === selectedCategoryId)
    : tasks;

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    if (!newName.trim()) return;
    addTask(newName, newEst, selectedCategoryId, undefined, newColor);
    setNewName('');
    setNewEst(1);
  };

  // Section is active if user is hovering or typing in the input
  const isSectionActive = isHovered || isInputFocused;

  return (
    <div 
      className="w-full max-w-lg mx-auto transition-all duration-700"
      onMouseEnter={() => setIsHovered(true)}
      onMouseLeave={() => setIsHovered(false)}
    >
      <div className={`transition-all duration-700 ease-out ${isSectionActive ? 'opacity-100' : 'opacity-60'}`}>
        {/* Header: Unblurs if typing or hovering */}
        <div className={`flex justify-between items-center mb-4 px-2 transition-all duration-500 ${isSectionActive ? 'blur-0 opacity-100' : 'blur-[2px] opacity-50'}`}>
          <h2 className="text-[10px] font-bold text-white/50 tracking-[0.2em] uppercase">Task List</h2>
        </div>

        {/* Add Task Input */}
        <form 
          onSubmit={handleSubmit} 
          className={`
            mb-8 relative group z-30 transition-all duration-500
            ${isInputFocused 
              ? 'scale-100 shadow-xl opacity-100 blur-0' 
              : 'scale-[0.98] shadow-none opacity-50 blur-[2px] hover:blur-0 hover:opacity-100'
            }
          `}
          onFocus={() => setIsInputFocused(true)}
          onBlur={(e) => {
            if (!e.currentTarget.contains(e.relatedTarget)) {
              setIsInputFocused(false);
            }
          }}
        >
          <div className={`
            bg-white/5 backdrop-blur-xl rounded-xl border 
            ${isInputFocused ? 'border-white/30 bg-white/15' : 'border-white/10 hover:border-white/20 hover:bg-white/10'}
            overflow-hidden transition-all duration-300
          `}>
            <div className="flex items-center p-1.5">
                <input 
                  type="text" 
                  placeholder={isInputFocused ? "Describe task..." : "+ New Task"} 
                  className="flex-1 bg-transparent px-4 py-2 text-glass-text placeholder-white/30 outline-none font-medium text-sm"
                  value={newName}
                  onChange={e => setNewName(e.target.value)}
                />
            </div>
            
            <div className={`
              overflow-hidden transition-all duration-300 ease-in-out border-t border-white/5
              ${isInputFocused ? 'max-h-16 opacity-100 py-2 px-4' : 'max-h-0 opacity-0 border-none'}
            `}>
              <div className="flex justify-between items-center">
                <div className="flex items-center gap-4">
                    {/* Color Picker */}
                    <div className="flex gap-1.5">
                      {PRESET_COLORS.map(c => (
                        <button
                          key={c}
                          type="button"
                          onClick={() => setNewColor(c)}
                          className={`w-3 h-3 rounded-full transition-transform duration-300 ${newColor === c ? 'scale-150 ring-1 ring-white/80' : 'hover:scale-125 opacity-50 hover:opacity-100'}`}
                          style={{ backgroundColor: c }}
                        />
                      ))}
                    </div>

                    <div className="w-px h-3 bg-white/10" />

                    {/* Estimate */}
                    <div className="flex items-center gap-2 text-[10px] text-white/60 font-mono tracking-wide">
                      <span className="font-bold">EST</span>
                      <input 
                          type="number" 
                          min="1" max="10"
                          className="w-8 py-0.5 bg-white/10 rounded text-center text-white outline-none focus:bg-white/20 border border-white/5 focus:border-white/30 transition-colors"
                          value={newEst}
                          onChange={e => setNewEst(Number(e.target.value))}
                      />
                    </div>
                </div>

                <button 
                    type="submit"
                    className="px-3 py-1 bg-white/90 text-black text-[10px] rounded-lg font-bold hover:bg-white transition-all shadow-lg active:scale-95 uppercase tracking-wider"
                >
                    Add
                </button>
              </div>
            </div>
          </div>
        </form>

        {/* Task List: Blurs completely if not hovering or typing */}
        <div className={`space-y-1 pb-20 transition-all duration-500 ${isSectionActive ? 'blur-0 opacity-100' : 'blur-[2px] opacity-40'}`}>
          {filteredTasks.map(task => (
            <TaskItem key={task.id} task={task} isSectionActive={isSectionActive} />
          ))}
        </div>
      </div>
    </div>
  );
};

export default Tasks;
