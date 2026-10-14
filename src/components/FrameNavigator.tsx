import { Button } from '@/components/ui/button';
import { Slider } from '@/components/ui/slider';
import { ChevronLeft, ChevronRight } from 'lucide-react';

interface FrameNavigatorProps {
  index: number;
  count: number;
  onChange: (index: number) => void;
}

// 장면 이동: 한 장씩(‹ ›)과 끌어서 멀리(막대) 둘 다. 장면이 수십 개면 버튼만으로는 너무 멀다.
export function FrameNavigator({ index, count, onChange }: FrameNavigatorProps) {
  const last = Math.max(0, count - 1);

  return (
    <div className="space-y-1">
      <div className="flex items-center gap-2">
        <Button
          onClick={() => onChange(index - 1)}
          disabled={index <= 0}
          variant="outline"
          size="icon"
          aria-label="이전 장면"
        >
          <ChevronLeft className="w-4 h-4" />
        </Button>

        <p className="flex-1 text-center text-sm tabular-nums">
          장면 <span className="font-semibold">{index + 1}</span>
          <span className="text-muted-foreground"> / {count}</span>
        </p>

        <Button
          onClick={() => onChange(index + 1)}
          disabled={index >= last}
          variant="outline"
          size="icon"
          aria-label="다음 장면"
        >
          <ChevronRight className="w-4 h-4" />
        </Button>
      </div>

      {count > 1 && (
        <Slider
          min={0}
          max={last}
          step={1}
          value={[index]}
          onValueChange={([v]) => v !== index && onChange(v)}
          aria-label="장면 이동"
        />
      )}
    </div>
  );
}
