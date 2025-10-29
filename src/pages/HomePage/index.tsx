import { useState } from "react";
import ChatBox from "../../components/Chat/ChatBox";
import MapView, { type MapPoint } from "../../components/Map/MapView";

const HomePage = () => {
  const [mapData, setMapData] = useState<MapPoint[]>([]);
  return (
    <div className="flex flex-col h-screen lg:flex-row">
      <div className="lg:w-[30%] hidden lg:block p-3">
        <ChatBox mapData={mapData} setMapData={setMapData} />
      </div>
      <div className="flex-1 p-3 h-full">
        <MapView points={mapData} />
      </div>
      <div className="lg:w-[30%] lg:hidden lg:static lg:h-full absolute bottom-0 h-72 md:h-96  block p-3">
        <ChatBox mapData={mapData} setMapData={setMapData} />
      </div>
    </div>
  );
};

export default HomePage;
