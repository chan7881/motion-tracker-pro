import { useEffect, useState } from 'react';
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
  DialogFooter,
} from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { HelpCircle, Upload, Ruler, Target, BarChart3 } from 'lucide-react';

const STORAGE_KEY = 'motion-tracker-help-seen';

const steps = [
  {
    icon: Upload,
    title: '① 영상을 올려요',
    description: '움직이는 물체를 찍은 동영상을 올리거나, 카메라로 바로 촬영해요.'
  },
  {
    icon: Ruler,
    title: '② 자로 길이를 알려줘요',
    description: '화면 속 자나 알고 있는 길이(예: 책상 길이)를 선으로 그어 실제 길이를 입력해요. 이래야 진짜 속도를 계산할 수 있어요.'
  },
  {
    icon: Target,
    title: '③ 물체를 네모로 감싸요',
    description: '움직이는 물체를 첫 장면에서 네모로 감싸주면, 나머지 장면은 컴퓨터가 자동으로 따라가요.'
  },
  {
    icon: BarChart3,
    title: '④ 결과를 확인해요',
    description: '위치·속도·가속도 그래프를 보고, 필요하면 표(CSV)나 영상으로 저장할 수 있어요.'
  }
];

interface HelpGuideProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
}

export function HelpGuide({ open, onOpenChange }: HelpGuideProps) {
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-lg">
        <DialogHeader>
          <DialogTitle className="text-xl">Motion Tracker 사용법</DialogTitle>
          <DialogDescription>
            네 단계만 따라 하면 물체의 움직임을 분석할 수 있어요.
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-4 py-2">
          {steps.map((step) => (
            <div key={step.title} className="flex gap-3 items-start">
              <div className="shrink-0 w-10 h-10 rounded-full bg-primary/10 flex items-center justify-center">
                <step.icon className="w-5 h-5 text-primary" />
              </div>
              <div>
                <p className="font-semibold">{step.title}</p>
                <p className="text-sm text-muted-foreground">{step.description}</p>
              </div>
            </div>
          ))}
        </div>

        <DialogFooter>
          <Button onClick={() => onOpenChange(false)} className="w-full">
            시작하기
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

// 처음 방문한 학생에게 자동으로 안내를 띄우기 위한 훅
export function useAutoShowHelp() {
  const [open, setOpen] = useState(false);

  useEffect(() => {
    const seen = window.localStorage.getItem(STORAGE_KEY);
    if (!seen) {
      setOpen(true);
    }
  }, []);

  const handleOpenChange = (next: boolean) => {
    setOpen(next);
    if (!next) {
      window.localStorage.setItem(STORAGE_KEY, '1');
    }
  };

  return { open, setOpen: handleOpenChange };
}

export function HelpButton({ onClick }: { onClick: () => void }) {
  return (
    <Button variant="ghost" size="icon" onClick={onClick} aria-label="도움말 보기">
      <HelpCircle className="w-5 h-5" />
    </Button>
  );
}
