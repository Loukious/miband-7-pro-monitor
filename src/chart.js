// Mi Band 7 Pro – Real-time Heart Rate Chart (ApexCharts)
import ApexCharts from "apexcharts";

const MAX_POINTS = 60; // keep 60 readings on screen

export class HrChart {
    constructor(selector) {
        this._data = [];
        const options = {
            chart: {
                id: "hr-realtime",
                type: "area",
                height: "100%",
                animations: { enabled: true, easing: "linear", dynamicAnimation: { speed: 800 } },
                toolbar: { show: false },
                background: "transparent",
            },
            theme: { mode: "dark" },
            dataLabels: { enabled: false },
            stroke: { curve: "smooth", width: 3, colors: ["#f43f5e"] },
            fill: {
                type: "gradient",
                gradient: {
                    shadeIntensity: 1,
                    opacityFrom: 0.45,
                    opacityTo: 0.05,
                    stops: [0, 100],
                    colorStops: [
                        { offset: 0, color: "#f43f5e", opacity: 0.5 },
                        { offset: 100, color: "#f43f5e", opacity: 0 },
                    ],
                },
            },
            markers: { size: 0 },
            xaxis: {
                type: "datetime",
                labels: {
                    format: "HH:mm:ss",
                    datetimeUTC: false,
                    style: { colors: "#94a3b8", fontSize: "11px" },
                },
                axisBorder: { color: "#1e293b" },
                axisTicks: { color: "#1e293b" },
            },
            yaxis: {
                min: 40,
                max: 180,
                tickAmount: 7,
                labels: {
                    formatter: v => Math.round(v),
                    style: { colors: "#94a3b8", fontSize: "11px" },
                    minWidth: 36,
                },
            },
            grid: {
                borderColor: "#1e293b",
                strokeDashArray: 4,
            },
            tooltip: {
                theme: "dark",
                x: { format: "HH:mm:ss" },
                y: { formatter: v => `${v} bpm` },
            },
            series: [{ name: "Heart Rate", data: [] }],
        };
        this.chart = new ApexCharts(document.querySelector(selector), options);
        this.chart.render();
    }

    push(ts, bpm) {
        this._data.push({ x: ts.getTime(), y: bpm });
        if (this._data.length > MAX_POINTS) this._data.shift();
        this.chart.updateSeries([{ data: this._data.slice() }]);
    }

    clear() {
        this._data = [];
        this.chart.updateSeries([{ data: [] }]);
    }
}

window.HrChart = HrChart;
