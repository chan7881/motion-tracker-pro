// 화면(client) 좌표를 캔버스 픽셀 좌표로 바꾼다.
// 캔버스는 CSS object-fit: contain으로 표시되므로, 영상 비율이 상자(16:9)와 다르면
// 좌우나 위아래에 검은 여백이 생긴다. 여백을 빼고 실제 그림이 놓인 영역 기준으로
// 환산해야 터치한 곳과 네모·기준선이 겹친다. 여백을 누르면 가장 가까운 가장자리로 붙인다.
export function clientToCanvas(
  canvas: HTMLCanvasElement,
  clientX: number,
  clientY: number
): { x: number; y: number } {
  const rect = canvas.getBoundingClientRect();
  const scale = Math.min(rect.width / canvas.width, rect.height / canvas.height);
  const offsetX = (rect.width - canvas.width * scale) / 2;
  const offsetY = (rect.height - canvas.height * scale) / 2;

  const x = (clientX - rect.left - offsetX) / scale;
  const y = (clientY - rect.top - offsetY) / scale;

  return {
    x: Math.min(canvas.width, Math.max(0, x)),
    y: Math.min(canvas.height, Math.max(0, y))
  };
}
