import java.io.*;

public class Main {
    static final long M = 1_000_000_007L;
    static long[] fib(long n) {
        if (n == 0) return new long[]{0, 1};
        long[] h = fib(n >> 1);
        long a = h[0], b = h[1];
        long c = a * ((2 * b - a + M) % M) % M;
        long d = (a * a + b * b) % M;
        return (n & 1) == 0 ? new long[]{c, d} : new long[]{d, (c + d) % M};
    }
    public static void main(String[] args) throws IOException {
        long n = Long.parseLong(new BufferedReader(new InputStreamReader(System.in)).readLine().trim());
        System.out.println(fib(n)[0]);
    }
}
