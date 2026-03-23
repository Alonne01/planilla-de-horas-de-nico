import { cn } from '@/lib/utils';
import { User, Users } from 'lucide-react';

interface ScopeToggleProps {
  value: 'mio' | 'equipo';
  onChange: (v: 'mio' | 'equipo') => void;
}

export default function ScopeToggle({ value, onChange }: ScopeToggleProps) {
  return (
    <div className="flex bg-muted/30 rounded-lg p-0.5">
      <button
        onClick={() => onChange('mio')}
        className={cn(
          'flex items-center gap-1.5 px-3 py-1.5 rounded-md text-xs font-medium transition-all',
          value === 'mio' ? 'bg-card shadow text-foreground' : 'text-muted-foreground hover:text-foreground',
        )}
      >
        <User className="h-3.5 w-3.5" /> Mío
      </button>
      <button
        onClick={() => onChange('equipo')}
        className={cn(
          'flex items-center gap-1.5 px-3 py-1.5 rounded-md text-xs font-medium transition-all',
          value === 'equipo' ? 'bg-card shadow text-foreground' : 'text-muted-foreground hover:text-foreground',
        )}
      >
        <Users className="h-3.5 w-3.5" /> Mi Equipo
      </button>
    </div>
  );
}
