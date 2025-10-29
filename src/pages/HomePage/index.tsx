import { useState } from "react";
import ChatBox from "../../components/Chat/ChatBox";
import MapView, { type MapPoint } from "../../components/Map/MapView";

const HomePage = () => {
  const [mapData, setMapData] = useState<MapPoint[]>([]);
  return (
    <div className="flex h-screen">
      <div className="w-[30%] p-3">
        <ChatBox mapData={mapData} setMapData={setMapData} />
      </div>
      <div className="flex-1 p-3">
        <MapView points={mapData} />
      </div>
    </div>
  );
};

export default HomePage;
