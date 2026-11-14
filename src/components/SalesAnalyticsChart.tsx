import React, { useMemo, useState } from 'react';
import type { CurrencyCode, SalesSeriesPoint } from '../types/zenorati';
import { formatCompactCurrency, formatCurrency, formatDateShort } from '../utils/formatters';
import { useI18n } from '../i18n/I18nContext';

interface SalesAnalyticsChartProps {
  data: SalesSeriesPoint[];
  currency: CurrencyCode;
}

export const SalesAnalyticsChart: React.FC<SalesAnalyticsChartProps> = ({ data, currency }) => {
  const { language, dir, t } = useI18n();
  const [hoveredIdx, setHoveredIdx] = useState<number | null>(null);
  const [showRevenue, setShowRevenue] = useState(true);
  const [showProfit, setShowProfit] = useState(true);
  const [showExpenses, setShowExpenses] = useState(true);

  const width = 760;
  const height = 270;
  const padLeft = 56;
  const padRight = 18;
  const padTop = 20;
  const padBottom = 34;
  const chartW = width - padLeft - padRight;
  const chartH = height - padTop - padBottom;

  const { minVal, maxVal, yTicks, points } = useMemo(() => {
    if (data.length === 0) {
      return {
        minVal: 0,
        maxVal: 1000,
        yTicks: [0, 250, 500, 750, 1000],
        points: [],
      };
    }

    let rawMin = 0;
    let rawMax = 100;
    for (const d of data) {
      const vals: number[] = [0];
      if (showRevenue) vals.push(d.revenue);
      if (showProfit) vals.push(d.netProfit);
      if (showExpenses) vals.push(d.expenses);
      for (const v of vals) {
        if (v < rawMin) rawMin = v;
        if (v > rawMax) rawMax = v;
      }
    }

    const paddedMax = rawMax <= 0 ? 100 : Math.ceil((rawMax * 1.15) / 10) * 10;
    const paddedMin = rawMin < 0 ? Math.floor((rawMin * 1.15) / 10) * 10 : 0;
    const span = Math.max(1, paddedMax - paddedMin);

    const step = span / 4;
    const ticks = [0, 1, 2, 3, 4].map((i) => Math.round(paddedMin + step * i));

    const pts = data.map((d, idx) => {
      const x =
        data.length === 1
          ? padLeft + chartW / 2
          : padLeft + (idx / (data.length - 1)) * chartW;
      const yFor = (val: number) =>
        padTop + chartH - ((val - paddedMin) / span) * chartH;
      return {
        ...d,
        idx,
        x,
        yRev: yFor(d.revenue),
        yProfit: yFor(d.netProfit),
        yExp: yFor(d.expenses),
        yZero: yFor(0),
      };
    });

    return { minVal: paddedMin, maxVal: paddedMax, yTicks: ticks, points: pts };
  }, [data, showRevenue, showProfit, showExpenses, chartW, chartH]);

  const buildSmoothPath = (coords: Array<{ x: number; y: number }>): string => {
    if (coords.length === 0) return '';
    if (coords.length === 1) return `M ${coords[0].x} ${coords[0].y}`;
    let d = `M ${coords[0].x.toFixed(1)} ${coords[0].y.toFixed(1)}`;
    for (let i = 0; i < coords.length - 1; i++) {
      const p0 = coords[i];
      const p1 = coords[i + 1];
      const cx = ((p0.x + p1.x) / 2).toFixed(1);
      d += ` C ${cx} ${p0.y.toFixed(1)}, ${cx} ${p1.y.toFixed(1)}, ${p1.x.toFixed(1)} ${p1.y.toFixed(1)}`;
    }
    return d;
  };

  const buildAreaPath = (coords: Array<{ x: number; y: number }>, baselineY: number): string => {
    if (coords.length === 0) return '';
    const line = buildSmoothPath(coords);
    const last = coords[coords.length - 1];
    const first = coords[0];
    return `${line} L ${last.x.toFixed(1)} ${baselineY.toFixed(1)} L ${first.x.toFixed(1)} ${baselineY.toFixed(1)} Z`;
  };

  const revCoords = points.map((p) => ({ x: p.x, y: p.yRev }));
  const profitCoords = points.map((p) => ({ x: p.x, y: p.yProfit }));
  const baselineY = points.length > 0 ? points[0].yZero : padTop + chartH;

  const activePoint = hoveredIdx !== null && points[hoveredIdx] ? points[hoveredIdx] : null;

  const labelInterval = Math.max(1, Math.ceil(points.length / 7));

  return (
    <div className="flex flex-col h-full">
      <div className="flex flex-wrap items-center justify-between gap-3 mb-4">
        <div>
          <h3 className="text-base font-semibold text-slate-900 dark:text-slate-100">
            {t('chartTitle')}
          </h3>
          <p className="text-xs text-slate-500 dark:text-slate-400 mt-0.5">
            {t('chartSubtitle')}
          </p>
        </div>

        <div className="flex items-center gap-2 flex-wrap">
          <button
            type="button"
            onClick={() => setShowRevenue((v) => !v)}
            className={`inline-flex items-center gap-2 px-2.5 py-1.5 rounded-lg text-xs font-medium transition-colors border whitespace-nowrap shrink-0 cursor-pointer ${
              showRevenue
                ? 'bg-blue-500/10 border-blue-500/30 text-blue-600 dark:text-blue-400'
                : 'bg-transparent border-slate-200 dark:border-slate-800 text-slate-500 dark:text-slate-400'
            }`}
          >
            <span className="w-2.5 h-2.5 rounded-sm bg-blue-500" aria-hidden="true" />
            {t('chartRevenue')}
          </button>
          <button
            type="button"
            onClick={() => setShowProfit((v) => !v)}
            className={`inline-flex items-center gap-2 px-2.5 py-1.5 rounded-lg text-xs font-medium transition-colors border whitespace-nowrap shrink-0 cursor-pointer ${
              showProfit
                ? 'bg-cyan-500/10 border-cyan-500/30 text-cyan-600 dark:text-cyan-400'
                : 'bg-transparent border-slate-200 dark:border-slate-800 text-slate-500 dark:text-slate-400'
            }`}
          >
            <span className="w-2.5 h-2.5 rounded-sm bg-cyan-400" aria-hidden="true" />
            {t('chartNetProfit')}
          </button>
          <button
            type="button"
            onClick={() => setShowExpenses((v) => !v)}
            className={`inline-flex items-center gap-2 px-2.5 py-1.5 rounded-lg text-xs font-medium transition-colors border whitespace-nowrap shrink-0 cursor-pointer ${
              showExpenses
                ? 'bg-purple-500/10 border-purple-500/30 text-purple-600 dark:text-purple-400'
                : 'bg-transparent border-slate-200 dark:border-slate-800 text-slate-500 dark:text-slate-400'
            }`}
          >
            <span className="w-2.5 h-2.5 rounded-sm bg-purple-500" aria-hidden="true" />
            {t('chartCostsExpenses')}
          </button>
        </div>
      </div>

      {data.length === 0 ? (
        <div className="flex-1 min-h-[220px] flex items-center justify-center border border-dashed border-slate-200 dark:border-slate-800 rounded-xl text-sm text-slate-500 dark:text-slate-400">
          {t('chartEmpty')}
        </div>
      ) : (
        <div className="relative w-full" dir="ltr">
          <svg
            viewBox={`0 0 ${width} ${height}`}
            className="w-full h-auto overflow-visible select-none"
            onMouseLeave={() => setHoveredIdx(null)}
            role="img"
            aria-label="Sales analytics chart showing revenue, net profit, and costs over time"
          >
            <defs>
              <linearGradient id="zenRevFill" x1="0" y1="0" x2="0" y2="1">
                <stop offset="0%" stopColor="#3B82F6" stopOpacity="0.32" />
                <stop offset="100%" stopColor="#3B82F6" stopOpacity="0.01" />
              </linearGradient>
              <linearGradient id="zenProfitFill" x1="0" y1="0" x2="0" y2="1">
                <stop offset="0%" stopColor="#06B6D4" stopOpacity="0.22" />
                <stop offset="100%" stopColor="#06B6D4" stopOpacity="0.0" />
              </linearGradient>
            </defs>

            {/* Horizontal grid lines & Y-axis labels */}
            {yTicks.map((tick, i) => {
              const span = Math.max(1, maxVal - minVal);
              const y = padTop + chartH - ((tick - minVal) / span) * chartH;
              return (
                <g key={i}>
                  <line
                    x1={padLeft}
                    y1={y}
                    x2={width - padRight}
                    y2={y}
                    stroke="currentColor"
                    className={
                      tick === 0
                        ? 'text-slate-300 dark:text-slate-700'
                        : 'text-slate-200/70 dark:text-slate-800/80'
                    }
                    strokeDasharray={tick === 0 ? undefined : '3 3'}
                    strokeWidth="1"
                  />
                  <text
                    x={padLeft - 10}
                    y={y + 4}
                    textAnchor="end"
                    className="fill-slate-400 dark:fill-slate-500 text-[10px] font-mono tabular-nums"
                  >
                    {formatCompactCurrency(tick, currency, language)}
                  </text>
                </g>
              );
            })}

            {/* Costs & Expenses subtle bars */}
            {showExpenses &&
              points.map((p) => {
                const barW = Math.max(4, Math.min(18, chartW / Math.max(8, points.length * 2.4)));
                const top = Math.min(p.yExp, p.yZero);
                const h = Math.max(0, Math.abs(p.yZero - p.yExp));
                return (
                  <rect
                    key={`exp-${p.date}`}
                    x={p.x - barW / 2}
                    y={top}
                    width={barW}
                    height={h}
                    rx={3}
                    fill="#8B5CF6"
                    opacity={hoveredIdx === p.idx ? 0.55 : 0.28}
                    className="transition-opacity duration-150"
                  />
                );
              })}

            {/* Revenue area & curve */}
            {showRevenue && points.length > 0 && (
              <>
                <path d={buildAreaPath(revCoords, baselineY)} fill="url(#zenRevFill)" />
                <path
                  d={buildSmoothPath(revCoords)}
                  fill="none"
                  stroke="#3B82F6"
                  strokeWidth="2.5"
                  strokeLinecap="round"
                />
              </>
            )}

            {/* Net Profit area & curve */}
            {showProfit && points.length > 0 && (
              <>
                <path d={buildAreaPath(profitCoords, baselineY)} fill="url(#zenProfitFill)" />
                <path
                  d={buildSmoothPath(profitCoords)}
                  fill="none"
                  stroke="#22D3EE"
                  strokeWidth="2.25"
                  strokeLinecap="round"
                />
              </>
            )}

            {/* Active hover crosshair & markers */}
            {activePoint && (
              <g>
                <line
                  x1={activePoint.x}
                  y1={padTop}
                  x2={activePoint.x}
                  y2={padTop + chartH}
                  stroke="#64748B"
                  strokeWidth="1"
                  strokeDasharray="3 3"
                />
                {showRevenue && (
                  <circle
                    cx={activePoint.x}
                    cy={activePoint.yRev}
                    r="4.5"
                    fill="#3B82F6"
                    stroke="#0F172A"
                    strokeWidth="2"
                  />
                )}
                {showProfit && (
                  <circle
                    cx={activePoint.x}
                    cy={activePoint.yProfit}
                    r="4.5"
                    fill="#22D3EE"
                    stroke="#0F172A"
                    strokeWidth="2"
                  />
                )}
              </g>
            )}

            {/* X-axis labels */}
            {points.map((p, idx) => {
              const show = idx % labelInterval === 0 || idx === points.length - 1;
              if (!show) return null;
              return (
                <text
                  key={`x-${p.date}`}
                  x={p.x}
                  y={height - 8}
                  textAnchor="middle"
                  className="fill-slate-400 dark:fill-slate-500 text-[10px] font-mono tabular-nums"
                >
                  {p.label}
                </text>
              );
            })}

            {/* Interactive hover hit zones */}
            {points.map((p) => {
              const sliceW = points.length > 1 ? chartW / (points.length - 1) : chartW;
              return (
                <rect
                  key={`hit-${p.date}`}
                  x={Math.max(padLeft, p.x - sliceW / 2)}
                  y={padTop}
                  width={sliceW}
                  height={chartH}
                  fill="transparent"
                  className="cursor-crosshair"
                  onMouseEnter={() => setHoveredIdx(p.idx)}
                />
              );
            })}
          </svg>

          {/* Floating crisp tooltip */}
          {activePoint && (
            <div
              dir={dir}
              className="pointer-events-none absolute top-2 z-10 w-56 rounded-xl border border-slate-200 dark:border-slate-700/80 bg-white/95 dark:bg-slate-900/95 backdrop-blur-md p-3 shadow-xl"
              style={{
                left: activePoint.idx > points.length / 2 ? '16px' : 'auto',
                right: activePoint.idx > points.length / 2 ? 'auto' : '16px',
              }}
            >
              <div className="flex items-center justify-between text-xs font-medium text-slate-500 dark:text-slate-400 mb-2 pb-1.5 border-b border-slate-100 dark:border-slate-800">
                <span>{formatDateShort(activePoint.date, language)}</span>
                <span className="font-mono tabular-nums">
                  {t('chartOrdersCount', { count: activePoint.orders })}
                </span>
              </div>
              <div className="space-y-1.5 text-xs">
                <div className="flex items-center justify-between">
                  <span className="text-slate-600 dark:text-slate-300">{t('chartRevenue')}</span>
                  <span className="font-mono tabular-nums font-semibold text-blue-600 dark:text-blue-400">
                    {formatCurrency(activePoint.revenue, currency, 2, language)}
                  </span>
                </div>
                <div className="flex items-center justify-between">
                  <span className="text-slate-600 dark:text-slate-300">
                    {t('chartCostsExpenses')}
                  </span>
                  <span className="font-mono tabular-nums font-semibold text-purple-600 dark:text-purple-400">
                    {formatCurrency(activePoint.expenses, currency, 2, language)}
                  </span>
                </div>
                <div className="flex items-center justify-between pt-1 border-t border-slate-100 dark:border-slate-800">
                  <span className="font-medium text-slate-900 dark:text-slate-100">
                    {t('chartNetProfit')}
                  </span>
                  <span
                    className={`font-mono tabular-nums font-semibold ${
                      activePoint.netProfit >= 0
                        ? 'text-cyan-600 dark:text-cyan-400'
                        : 'text-rose-600 dark:text-rose-400'
                    }`}
                  >
                    {formatCurrency(activePoint.netProfit, currency, 2, language)}
                  </span>
                </div>
              </div>
            </div>
          )}
        </div>
      )}
    </div>
  );
};
