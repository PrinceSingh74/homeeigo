"use client"

export default function Home() {
  return (
    <main className="min-h-screen bg-gradient-to-br from-homigo-50 via-blue-50 to-homigo-100">
      <div className="container mx-auto px-4 py-20">
        {/* Header */}
        <div className="text-center mb-16">
          <h1 className="text-6xl font-bold bg-gradient-to-r from-blue-600 to-violet-600 bg-clip-text text-transparent mb-4">
            HOMIGO
          </h1>
          <p className="text-2xl text-gray-600 mb-4">
            The Future of Home Services
          </p>
          <p className="text-lg text-gray-500">
            AI-Powered Luxury Home Services Marketplace
          </p>
        </div>

        {/* Status Cards */}
        <div className="grid grid-cols-1 md:grid-cols-3 gap-6 mb-12">
          {/* Frontend Status */}
          <div className="bg-white rounded-2xl p-8 shadow-lg hover:shadow-xl transition-shadow">
            <div className="text-4xl mb-4">🎨</div>
            <h3 className="text-xl font-semibold mb-2">Frontend</h3>
            <p className="text-gray-600">Next.js 15</p>
            <p className="text-green-600 font-semibold mt-4">✅ Running</p>
          </div>

          {/* Backend Status */}
          <div className="bg-white rounded-2xl p-8 shadow-lg hover:shadow-xl transition-shadow">
            <div className="text-4xl mb-4">⚙️</div>
            <h3 className="text-xl font-semibold mb-2">Backend</h3>
            <p className="text-gray-600">Bun + Elysia.js</p>
            <p className="text-green-600 font-semibold mt-4">✅ Running</p>
          </div>

          {/* Database Status */}
          <div className="bg-white rounded-2xl p-8 shadow-lg hover:shadow-xl transition-shadow">
            <div className="text-4xl mb-4">💾</div>
            <h3 className="text-xl font-semibold mb-2">Database</h3>
            <p className="text-gray-600">PostgreSQL 16</p>
            <p className="text-yellow-600 font-semibold mt-4">⏳ Setup Pending</p>
          </div>
        </div>

        {/* Quick Start */}
        <div className="bg-white rounded-2xl p-8 shadow-lg">
          <h2 className="text-2xl font-bold mb-6">Phase 1 Status</h2>
          <div className="space-y-4">
            <div className="flex items-center">
              <span className="text-green-600 text-2xl mr-4">✅</span>
              <span>GitHub Repository Created</span>
            </div>
            <div className="flex items-center">
              <span className="text-green-600 text-2xl mr-4">✅</span>
              <span>Project Structure Set Up</span>
            </div>
            <div className="flex items-center">
              <span className="text-green-600 text-2xl mr-4">✅</span>
              <span>Bun & Next.js Installed</span>
            </div>
            <div className="flex items-center">
              <span className="text-yellow-600 text-2xl mr-4">⏳</span>
              <span>Database Configuration</span>
            </div>
            <div className="flex items-center">
              <span className="text-yellow-600 text-2xl mr-4">⏳</span>
              <span>Environment Setup</span>
            </div>
          </div>
        </div>

        {/* Next Steps */}
        <div className="mt-12 text-center">
          <h3 className="text-xl font-semibold mb-4">Next Steps</h3>
          <ol className="text-left max-w-2xl mx-auto space-y-2 bg-white rounded-xl p-6">
            <li><strong>1.</strong> Setup PostgreSQL database locally</li>
            <li><strong>2.</strong> Configure .env files with credentials</li>
            <li><strong>3.</strong> Create Prisma schema</li>
            <li><strong>4.</strong> Test API connections</li>
            <li><strong>5.</strong> Start Phase 2 - Design System</li>
          </ol>
        </div>
      </div>
    </main>
  )
}
