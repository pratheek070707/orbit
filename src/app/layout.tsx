import type { Metadata } from "next";
import "./globals.css";
export const metadata:Metadata={title:"Orbit · Repository Intelligence",description:"A clear view of the open source ecosystem around your work."};
export default function RootLayout({children}:{children:React.ReactNode}){return <html lang="en"><body>{children}</body></html>;}
