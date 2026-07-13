"use client";

import { Line, LineChart, ResponsiveContainer, Tooltip, XAxis, YAxis } from "recharts";

const data = [
  { name: "Mon", deployments: 12 },
  { name: "Tue", deployments: 19 },
  { name: "Wed", deployments: 15 },
  { name: "Thu", deployments: 22 },
  { name: "Fri", deployments: 30 },
  { name: "Sat", deployments: 8 },
  { name: "Sun", deployments: 5 },
];

export function DashboardCharts() {
  return (
    <div className="h-full w-full flex flex-col pt-4">
      <div className="flex flex-col mb-4">
        <h3 className="text-xl font-semibold text-white">Deployment Activity</h3>
        <p className="text-sm text-muted-foreground">Number of deployments over the last 7 days.</p>
      </div>
      <div className="flex-1 min-h-[200px] w-full">
        <ResponsiveContainer width="100%" height="100%">
          <LineChart data={data} margin={{ top: 5, right: 10, left: 10, bottom: 0 }}>
            <XAxis 
              dataKey="name" 
              stroke="#71717A" 
              fontSize={12} 
              tickLine={false} 
              axisLine={false} 
            />
            <YAxis 
              stroke="#71717A" 
              fontSize={12} 
              tickLine={false} 
              axisLine={false} 
              tickFormatter={(value) => `${value}`} 
            />
            <Tooltip 
              contentStyle={{ backgroundColor: "#18181B", border: "1px solid rgba(255,255,255,0.08)", borderRadius: "8px" }}
              itemStyle={{ color: "#FFF" }}
            />
            <Line 
              type="monotone" 
              dataKey="deployments" 
              stroke="#FFF" 
              strokeWidth={2} 
              dot={{ r: 4, fill: "#FFF" }} 
              activeDot={{ r: 6, fill: "#FFF" }} 
            />
          </LineChart>
        </ResponsiveContainer>
      </div>
    </div>
  );
}
