import React from "react";
import { Route, type RouteObject } from "react-router-dom";


const HomePage = React.lazy(() => import("../pages/HomePage"));

const withSuspense = (Component: React.LazyExoticComponent<React.FC>) => {
  return (
    <React.Suspense fallback={<div>Loading...</div>}>
      <Component />
    </React.Suspense>
  );
};

export const routes: RouteObject[] = [
    {
        path: "/",
        element: withSuspense(HomePage),
    }
]

export const generateRoutes = () => {
  return routes.map((route, index) => (
    <Route key={index} path={route.path} element={route.element} />
  ));
};