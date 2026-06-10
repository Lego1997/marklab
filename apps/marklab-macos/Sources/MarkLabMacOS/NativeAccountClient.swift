import Foundation

public struct NativeAccountUser: Codable, Equatable, Sendable {
  public let userId: String
  public let email: String
  public let displayName: String

  public init(userId: String, email: String, displayName: String) {
    self.userId = userId
    self.email = email
    self.displayName = displayName
  }
}

public struct NativeWorkspaceSummary: Codable, Equatable, Sendable {
  public let workspaceId: String
  public let name: String
  public let role: String

  public init(workspaceId: String, name: String, role: String) {
    self.workspaceId = workspaceId
    self.name = name
    self.role = role
  }
}

public struct NativeAppleSignInResult: Decodable, Equatable, Sendable {
  public let token: String
  public let user: NativeAccountUser
  public let expiresAt: String
}

public final class NativeAccountClient: @unchecked Sendable {
  private let apiBaseURL: URL
  private let bearerToken: String
  private let transport: NativeHTTPTransport

  public init(
    apiBaseURL: URL,
    bearerToken: String,
    transport: NativeHTTPTransport = URLSessionNativeHTTPTransport()
  ) {
    self.apiBaseURL = apiBaseURL
    self.bearerToken = bearerToken
    self.transport = transport
  }

  public func currentUser() async throws -> NativeAccountUser {
    struct Response: Decodable {
      let authenticated: Bool
      let user: NativeAccountUser?
    }
    let response = try await sendJSON("GET", "/api/auth/session", response: Response.self)
    guard response.authenticated, let user = response.user else {
      throw NativeHTTPError.httpStatus(401)
    }
    return user
  }

  public func listWorkspaces() async throws -> [NativeWorkspaceSummary] {
    struct Response: Decodable {
      let workspaces: [NativeWorkspaceSummary]
    }
    return try await sendJSON("GET", "/api/workspaces", response: Response.self).workspaces
  }

  public func createWorkspace(name: String) async throws -> NativeWorkspaceSummary {
    struct Body: Encodable {
      let name: String
    }
    struct Response: Decodable {
      let workspace: NativeWorkspaceSummary
    }
    return try await sendJSON(
      "POST",
      "/api/workspaces",
      body: try nativeJSONData(Body(name: name)),
      response: Response.self
    ).workspace
  }

  public func logout() async throws {
    _ = try await sendJSON("POST", "/api/auth/logout", response: EmptyNativeResponse.self)
  }

  /// Exchanges a native Sign in with Apple credential for a hosted session.
  ///
  /// This endpoint mints the session, so it is unauthenticated (no bearer) and
  /// proves it originates from the native app via the `X-MarkLab-Native-App` header.
  public static func authenticateWithApple(
    apiBaseURL: URL,
    identityToken: String,
    authorizationCode: String?,
    fullName: String?,
    transport: NativeHTTPTransport = URLSessionNativeHTTPTransport()
  ) async throws -> NativeAppleSignInResult {
    struct UserBody: Encodable {
      let name: String?
    }
    struct Body: Encodable {
      let identityToken: String
      let authorizationCode: String?
      let user: UserBody
    }
    let body = try nativeJSONData(Body(
      identityToken: identityToken,
      authorizationCode: authorizationCode,
      user: UserBody(name: fullName)
    ))
    let request = NativeHTTPRequest(
      method: "POST",
      url: appendPath("/api/auth/apple/native", to: apiBaseURL),
      headers: [
        "Content-Type": "application/json",
        "X-MarkLab-Native-App": "1",
      ],
      body: body
    )
    return try decodeNativeJSON(NativeAppleSignInResult.self, from: try await transport.send(request))
  }

  private func sendJSON<Response: Decodable>(
    _ method: String,
    _ path: String,
    body: Data? = nil,
    response responseType: Response.Type
  ) async throws -> Response {
    var headers = ["Authorization": "Bearer \(bearerToken)"]
    if body != nil {
      headers["Content-Type"] = "application/json"
    }
    let request = NativeHTTPRequest(
      method: method,
      url: appendPath(path, to: apiBaseURL),
      headers: headers,
      body: body
    )
    return try decodeNativeJSON(responseType, from: try await transport.send(request))
  }
}
