import RoverObstacleAlert from './components/RoverObstacleAlert'; // EKSPLORADOR_OBSTACLE_ALERT_V1
import React from "react";
import ReactDOM from "react-dom/client";
import App from "./App";
import "leaflet/dist/leaflet.css";

ReactDOM.createRoot(document.getElementById("root")).render(
  <React.StrictMode>
    <><App /><RoverObstacleAlert /></>
  </React.StrictMode>,
);